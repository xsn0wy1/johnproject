<?php
declare(strict_types=1);
namespace Hospital\Modules\Routes;
use Hospital\Modules\Transfers\TransferInput;

/** User-triggered demo address lookup, cached in SQL; never invents a map path. */
final class RouteMapper
{
    private \PDO $db;
    private array $config;
    private float $deadline;
    public function __construct(\PDO $db,array $config) { $this->db=$db; $this->config=$config; }
    public function path(array $places): ?array
    {
        if (!($this->config['route_mapping_enabled']??true)) return null;
        $this->deadline=microtime(true)+12;
        try {
            $coordinates=[];
            foreach ($places as $place) {
                // Existing exact catalog coordinates need no external lookup.
                $s=$this->db->prepare('SELECT latitude,longitude FROM facilities WHERE name=? AND address=? AND latitude IS NOT NULL AND longitude IS NOT NULL LIMIT 2'); $s->execute([$place['name'],$place['address']]); $known=$s->fetchAll();
                if (count($known)===1) $point=['latitude'=>(float)$known[0]['latitude'],'longitude'=>(float)$known[0]['longitude']];
                else {
                    $query=$place['address']!==''?$place['address']:$place['name'];
                    $data=$this->cached(($this->config['geocoder_url']??'https://photon.komoot.io/api/').'?'.http_build_query(['q'=>$query,'countrycode'=>$this->config['map_country']??'UY','limit'=>1]));
                    $xy=$data['features'][0]['geometry']['coordinates']??null;
                    if (!is_array($xy) || count($xy)!==2) return null;
                    $point=['latitude'=>$xy[1],'longitude'=>$xy[0]];
                }
                foreach (['latitude'=>90,'longitude'=>180] as $key=>$limit) if (!is_numeric($point[$key]) || !is_finite((float)$point[$key]) || abs((float)$point[$key])>$limit) return null;
                $coordinates[]=(float)$point['longitude'].','.(float)$point['latitude'];
            }
            $data=$this->cached(rtrim($this->config['router_url']??'https://router.project-osrm.org/route/v1/driving','/').'/'.implode(';',$coordinates).'?overview=full&geometries=geojson&steps=false');
            $route=$data['routes'][0]??null;
            if (($data['code']??null)!=='Ok' || !is_array($route) || ($route['distance']??0)<1 || ($route['duration']??0)<1) return null;
            $raw=$route['geometry']['coordinates']??[];
            if (!is_array($raw) || count($raw)<2) return null;
            // Keep bounded storage while retaining the endpoints of long road paths.
            if (count($raw)>1000) { $selected=[]; for ($i=0;$i<1000;$i++) $selected[]=$raw[(int)round($i*(count($raw)-1)/999)]; $raw=$selected; }
            $points=array_map(static fn(array $xy):array=>['latitude'=>$xy[1],'longitude'=>$xy[0]],$raw);
            $valid=TransferInput::geometry($points);
            return ['geometry'=>json_encode($valid['points'],JSON_THROW_ON_ERROR),'distance_meters'=>(int)round($route['distance']),'duration_seconds'=>max(1,(int)round($route['duration']))];
        } catch (\Throwable $e) {
            error_log('[Hospital route mapping] Lookup unavailable: '.get_class($e));
            return null;
        }
    }
    private function cached(string $url): ?array
    {
        $key=hash('sha256',$url);
        $read=function() use($key) { $s=$this->db->prepare('SELECT payload FROM route_map_cache WHERE cache_key=? AND expires_at>UTC_TIMESTAMP()'); $s->execute([$key]); return $s->fetchColumn(); };
        $saved=$read(); if ($saved!==false) return json_decode($saved,true,64,JSON_THROW_ON_ERROR);
        if (!str_starts_with($url,'https://') || microtime(true)>$this->deadline) return null;
        // One request at a time and at most one/second across this installation.
        $lock='hospital-map-http'; $s=$this->db->prepare('SELECT GET_LOCK(?,2)'); $s->execute([$lock]); if ((int)$s->fetchColumn()!==1) return null;
        try {
            $saved=$read(); if ($saved!==false) return json_decode($saved,true,64,JSON_THROW_ON_ERROR);
            $ch=curl_init($url); $body='';
            curl_setopt_array($ch,[CURLOPT_USERAGENT=>'HospitalSchoolProject/1.0 (fictional route planning)',CURLOPT_CONNECTTIMEOUT_MS=>2000,CURLOPT_TIMEOUT_MS=>max(1,min(4000,(int)(1000*($this->deadline-microtime(true))))),CURLOPT_FOLLOWLOCATION=>false,CURLOPT_HTTPHEADER=>['Accept: application/json'],CURLOPT_WRITEFUNCTION=>static function($ch,string $chunk) use(&$body):int { if (strlen($body)+strlen($chunk)>2097152) return 0; $body.=$chunk; return strlen($chunk); }]);
            $started=microtime(true); $ok=curl_exec($ch); $status=curl_getinfo($ch,CURLINFO_HTTP_CODE); curl_close($ch);
            $wait=1-(microtime(true)-$started); if ($wait>0) usleep((int)($wait*1000000));
            $data=$ok!==false && $status===200?json_decode($body,true,64):null;
            if (!is_array($data)) $data=null;
            $missing=$data===null || (isset($data['features'])&&!$data['features']) || (isset($data['code'])&&$data['code']!=='Ok');
            $ttl=$missing?300:2592000;
            $s=$this->db->prepare('INSERT INTO route_map_cache (cache_key,payload,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)'); $s->execute([$key,json_encode($data,JSON_THROW_ON_ERROR),gmdate('Y-m-d H:i:s',time()+$ttl)]);
            return $data;
        } finally { $s=$this->db->prepare('SELECT RELEASE_LOCK(?)'); $s->execute([$lock]); }
    }
}
