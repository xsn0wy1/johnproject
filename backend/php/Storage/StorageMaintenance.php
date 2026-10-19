<?php
declare(strict_types=1);
namespace Hospital\Storage;

/** Administrative filesystem operations; never repairs SQL by inventing file bytes. */
final class StorageMaintenance
{
    private \PDO $db;
    private array $config;
    public function __construct(\PDO $db,array $config) { $this->db=$db;$this->config=$config; }
    public function check(): array
    {
        $storage=new PrivateStorage($this->config);$result=['checked_as'=>function_exists('posix_geteuid')?(posix_getpwuid(posix_geteuid())['name']??'unknown'):PHP_SAPI,'areas'=>[],'missing'=>[],'mismatched'=>[]];
        foreach (['users','documents','quarantine'] as $area) {
            $path=rtrim($this->config['storage_path'],'/').'/'.$area;
            $result['areas'][$area]=['exists'=>is_dir($path),'readable'=>is_readable($path),'writable'=>is_writable($path)];
        }
        foreach ($this->db->query("SELECT id,storage_key,purpose,byte_size,sha256 FROM stored_files WHERE state='ready'")->fetchAll() as $row) {
            $area=$row['purpose']==='avatar'?'users':'documents';$extension=$area==='users'?'png':'bin';
            $path=rtrim($this->config['storage_path'],'/').'/'.$area.'/'.$row['storage_key'].'.'.$extension;
            if (!preg_match('/^[a-f0-9]{64}$/',$row['storage_key']) || !is_file($path) || is_link($path)) $result['missing'][]=(string)$row['id'];
            elseif (filesize($path)!==(int)$row['byte_size'] || !hash_equals($row['sha256'],hash_file('sha256',$path))) $result['mismatched'][]=(string)$row['id'];
        }
        return $result;
    }
    public function prepare(?string $webUser=null): void
    {
        if (PHP_SAPI!=='cli') throw new \RuntimeException('CLI only.');
        $identity=null;
        if ($webUser!==null) {
            if (!preg_match('/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/',$webUser) || !function_exists('posix_getpwnam') || !($identity=posix_getpwnam($webUser))) throw new \RuntimeException('Unknown web-server user.');
        }
        $storage=new PrivateStorage($this->config);
        foreach (['users','documents','quarantine'] as $area) { $path=$storage->directory($area,true);if(!chmod($path,0700))throw new \RuntimeException('Cannot protect storage area.'); }
        $root=realpath($this->config['storage_path']);if(!chmod($root,0700))throw new \RuntimeException('Cannot protect storage root.');
        if ($webUser===null) return;
        if (PHP_OS_FAMILY==='Darwin') {
            $this->acl($root,'user:'.$webUser.' allow search,readattr,readsecurity');
            foreach (['users','documents','quarantine'] as $area) $this->acl($storage->directory($area),'user:'.$webUser.' allow list,search,add_file,add_subdirectory,delete_child,readattr,readextattr,readsecurity');
            foreach (['users'=>'png','documents'=>'bin'] as $area=>$extension) foreach (glob($storage->directory($area).'/*.'.$extension) as $file) if (!is_link($file)) $this->acl($file,'user:'.$webUser.' allow read,readattr,readextattr,readsecurity');
        } else {
            if (!chown($root,$identity['uid'])) throw new \RuntimeException('Run storage preparation with ownership-changing privileges.');
            foreach (['users'=>'png','documents'=>'bin','quarantine'=>'bin'] as $area=>$extension) {
                if (!chown($storage->directory($area),$identity['uid'])) throw new \RuntimeException('Cannot set storage ownership.');
                foreach (glob($storage->directory($area).'/*.'.$extension) as $file) if (!is_link($file)&&!chown($file,$identity['uid'])) throw new \RuntimeException('Cannot set file ownership.');
            }
        }
    }
    private function acl(string $path,string $entry): void
    {
        $process=proc_open(['/bin/chmod','+a',$entry,$path],[0=>['file','/dev/null','r'],1=>['file','/dev/null','w'],2=>['file','/dev/null','w']],$pipes);
        if (!is_resource($process)||proc_close($process)!==0) throw new \RuntimeException('Cannot grant web-server storage access.');
    }
    public function recover(string $backup): array
    {
        if (PHP_SAPI!=='cli'||!str_starts_with($backup,DIRECTORY_SEPARATOR)||!($backup=realpath($backup))) throw new \RuntimeException('Use an existing absolute private backup directory.');
        $storage=new PrivateStorage($this->config);$restored=[];$unavailable=[];
        foreach ($this->db->query("SELECT id,storage_key,purpose,byte_size,sha256 FROM stored_files WHERE state='ready'")->fetchAll() as $row) {
            if (!preg_match('/^[a-f0-9]{64}$/',$row['storage_key'])) { $unavailable[]=(string)$row['id'];continue; }
            $area=$row['purpose']==='avatar'?'users':'documents';$ext=$area==='users'?'png':'bin';
            $directory=$storage->directory($area,true);$target=$storage->path($area,$row['storage_key'],$ext);
            if (file_exists($target)) continue;
            $source=$backup.'/'.$area.'/'.$row['storage_key'].'.'.$ext;
            if (!is_file($source)||is_link($source)||filesize($source)!==(int)$row['byte_size']||!hash_equals($row['sha256'],hash_file('sha256',$source))) { $unavailable[]=(string)$row['id'];continue; }
            $old=umask(0077);$in=fopen($source,'rb');$out=fopen($target,'xb');umask($old);
            if (!$in||!$out) throw new \RuntimeException('Cannot restore private file.');
            try { $size=stream_copy_to_stream($in,$out); } finally { fclose($in);fclose($out); }
            if ($size!==(int)$row['byte_size'] || !hash_equals($row['sha256'],hash_file('sha256',$target))) { unlink($target);throw new \RuntimeException('Backup changed during restoration.'); }
            $restored[]=(string)$row['id'];
        }
        return ['restored'=>$restored,'unavailable'=>$unavailable];
    }
}
