<?php
declare(strict_types=1);
namespace Hospital\Modules\Surveys;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;

final class SurveyService
{
    private \PDO $db;private array $config;private UserRepository $users;
    public function __construct(\PDO $db,array $config) { $this->db=$db;$this->config=$config;$this->users=new UserRepository($db); }
    private function query(string $sql,array $params=[]): \PDOStatement { $s=$this->db->prepare($sql);$s->execute($params);return $s; }
    private function admin(string $actor): bool { return in_array('admin',$this->users->roles($actor),true); }
    private function actor(string $actor): void
    {
        $u=$this->users->byId($actor,true);
        if (!$u||$u['status']!=='active'||$u['staff_status']!=='active'||(int)$u['auth_version']!==(int)($_SESSION['auth_version']??0))throw new ApiException(401,'SESSION_EXPIRED','La sesión venció.');
    }
    private function row(string $actor,string $id,bool $lock=false): array
    {
        $r=$this->query('SELECT s.*,COALESCE(NULLIF(st.full_name,\'\'),u.username) AS owner_name FROM surveys s JOIN users u ON u.id=s.owner_id LEFT JOIN staff st ON st.id=u.staff_id WHERE s.id=?'.($lock?' FOR UPDATE':''),[$id])->fetch();
        if (!$r||((string)$r['owner_id']!==$actor&&!$this->admin($actor)))throw new ApiException(404,'SURVEY_NOT_FOUND','No se encontró la encuesta.');return $r;
    }
    private function items(string $id): array
    {
        return array_map(static function($r){$settings=json_decode($r['settings'],true,32,JSON_THROW_ON_ERROR);return ['id'=>$r['item_key'],'type'=>$r['type'],'title'=>$r['title'],'required'=>(bool)$r['required']]+$settings;},$this->query('SELECT * FROM survey_items WHERE survey_id=? ORDER BY position',[$id])->fetchAll());
    }
    private function putItems(string $id,array $items): void
    {
        $this->query('DELETE FROM survey_items WHERE survey_id=?',[$id]);
        foreach ($items as $position=>$item) {
            $settings=array_diff_key($item,array_flip(['id','type','title','required']));
            $this->query('INSERT INTO survey_items (survey_id,item_key,position,type,title,required,settings) VALUES (?,?,?,?,?,?,?)',[$id,$item['id'],$position,$item['type'],$item['title'],(int)$item['required'],json_encode($settings,JSON_THROW_ON_ERROR)]);
        }
    }
    private function count(string $id): int { return (int)$this->query('SELECT COUNT(*) FROM survey_responses WHERE survey_id=?',[$id])->fetchColumn(); }
    private static function local(?string $date): string { return $date?(new \DateTimeImmutable($date,new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('America/Montevideo'))->format('Y-m-d\TH:i'):''; }
    private function serialize(array $r,bool $results=false): array
    {
        $id=(string)$r['id'];$count=$this->count($id);$status=$r['status'];
        if ($status==='published'&&(($r['closes_at']&&$r['closes_at']<=gmdate('Y-m-d H:i:s'))||($r['response_limit']!==null&&$count>=(int)$r['response_limit'])))$status='closed';
        $record=['id'=>$id,'version'=>(int)$r['version'],'owner_id'=>(string)$r['owner_id'],'owner_name'=>$r['owner_name'],'title'=>$r['title'],'description'=>$r['description'],'category'=>$r['category'],'area'=>$r['area'],'notes'=>$r['notes'],
            'form_title'=>$r['form_title'],'form_description'=>$r['form_description'],'color'=>$r['color'],'status'=>$r['archived_at']?'archived':$status,'lifecycle'=>$r['status'],'published_at'=>UserRepository::date($r['published_at']),
            'created_at'=>UserRepository::date($r['created_at']),'updated_at'=>UserRepository::date($r['updated_at']),'archived_at'=>UserRepository::date($r['archived_at']),
            'audience'=>$r['audience'],'accepting_responses'=>!$r['archived_at']&&$status==='published'&&(!$r['opens_at']||$r['opens_at']<=gmdate('Y-m-d H:i:s')),'response_count'=>$count,'questions'=>$this->items($id),
            'config'=>['audience'=>$r['audience'],'access'=>$r['access_mode'],'identity'=>$r['identity_mode'],'limit_enabled'=>$r['response_limit']!==null,'response_limit'=>$r['response_limit']===null?100:(int)$r['response_limit'],
                'opens_enabled'=>$r['opens_at']!==null,'opens_at'=>self::local($r['opens_at']),'closes_enabled'=>$r['closes_at']!==null,'closes_at'=>self::local($r['closes_at']),'completion_message'=>$r['completion_message']]];
        if ($results) {
            $record['results']=$this->results($id,$record['questions'],$count);
            $record['activity']=$this->query("SELECT DATE(DATE_SUB(submitted_at,INTERVAL 3 HOUR)) AS date,COUNT(*) AS count FROM survey_responses WHERE survey_id=? GROUP BY date ORDER BY date DESC LIMIT 7",[$id])->fetchAll();
            $record['activity']=array_reverse(array_map(static fn($r)=>['date'=>$r['date'],'count'=>(int)$r['count']],$record['activity']));
            $ratings=[];foreach ($record['questions'] as $q) if ($q['type']==='rating')foreach ($record['results'][$q['id']]['distribution'] as $bin)if ($bin['count'])$ratings[]=[$bin['value']/$q['rating_max']*5,$bin['count']];
            $n=array_sum(array_column($ratings,1));$record['average_rating']=$n?array_sum(array_map(static fn($v)=>$v[0]*$v[1],$ratings))/$n:null;$record['rating_scale']=5;$record['rating_count']=$n;
        }
        return $record;
    }
    public function get(string $actor,string $id): array { return $this->serialize($this->row($actor,$id),true); }
    public function listing(string $actor,int $page,int $size,bool $archived): array
    {
        $where='s.archived_at IS '.($archived?'NOT NULL':'NULL');$params=[];if (!$this->admin($actor)){$where.=' AND s.owner_id=?';$params[]=$actor;}
        $total=(int)$this->query('SELECT COUNT(*) FROM surveys s WHERE '.$where,$params)->fetchColumn();$offset=($page-1)*$size;
        $rows=$this->query('SELECT s.*,COALESCE(NULLIF(st.full_name,\'\'),u.username) AS owner_name FROM surveys s JOIN users u ON u.id=s.owner_id LEFT JOIN staff st ON st.id=u.staff_id WHERE '.$where.' ORDER BY s.updated_at DESC,s.id DESC LIMIT '.$size.' OFFSET '.$offset,$params)->fetchAll();
        return [array_map(function($r){$record=$this->serialize($r,true);unset($record['results'],$record['activity']);return $record;},$rows),$total];
    }
    public function save(string $actor,array $input,?string $id=null): array
    {
        [$fields,$items]=SurveyInput::fields($input);$this->db->beginTransaction();
        try {
            $this->actor($actor);
            if ($id===null) {
                $names=array_keys($fields);$this->query('INSERT INTO surveys (owner_id,'.implode(',',$names).') VALUES (?'.str_repeat(',?',count($names)).')',array_merge([$actor],array_values($fields)));$id=$this->db->lastInsertId();$this->putItems($id,$items);
            } else {
                $r=$this->row($actor,$id,true);$this->version($r,$input['version']??null);if ($r['archived_at'])throw new ApiException(409,'SURVEY_ARCHIVED','Restaurá la encuesta antes de editarla.');
                if ($r['published_at']) {
                    foreach (['form_title','form_description','color','audience','access_mode','identity_mode'] as $key)if ($fields[$key]!==$r[$key])throw new ApiException(409,'FORM_PUBLISHED','Duplicá la encuesta para cambiar el formulario publicado.');
                    if ($items!==$this->items($id))throw new ApiException(409,'FORM_PUBLISHED','Las preguntas publicadas no se pueden cambiar.');
                } else $this->putItems($id,$items);
                if ($fields['response_limit']!==null&&$fields['response_limit']<$this->count($id))SurveyInput::fail('El cupo no puede ser menor a las respuestas recibidas.');
                $this->query('UPDATE surveys SET '.implode(',',array_map(static fn($key)=>$key.'=?',array_keys($fields))).',version=version+1 WHERE id=?',array_merge(array_values($fields),[$id]));
            }
            $this->users->audit($actor,'survey.saved',$id,$GLOBALS['request_id']);$this->db->commit();return $this->get($actor,$id);
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
    private function version(array $r,$given): void { if (SurveyInput::integer($given,1,2147483647)!==(int)$r['version'])throw new ApiException(409,'VERSION_CONFLICT','La encuesta cambió. Volvé a abrirla.'); }
    public function transition(string $actor,string $id,$version,string $action): array
    {
        $this->db->beginTransaction();try {
            $this->actor($actor);$r=$this->row($actor,$id,true);$this->version($r,$version);
            if ($action==='restore') { if (!$r['archived_at'])throw new ApiException(409,'INVALID_STATE','La encuesta no está archivada.');$this->query('UPDATE surveys SET archived_at=NULL,version=version+1 WHERE id=?',[$id]); }
            elseif ($action==='archive')$this->query('UPDATE surveys SET archived_at=UTC_TIMESTAMP(),version=version+1 WHERE id=?',[$id]);
            else {
                if ($r['archived_at'])throw new ApiException(409,'SURVEY_ARCHIVED','La encuesta está archivada.');
                if ($action==='publish') {
                    if ($r['status']!=='draft')throw new ApiException(409,'INVALID_STATE','La encuesta ya fue publicada.');
                    $record=$this->serialize($r);SurveyInput::fields(['title'=>$r['title'],'description'=>$r['description'],'category'=>$r['category'],'area'=>$r['area'],'notes'=>$r['notes'],'form_title'=>$r['form_title'],'form_description'=>$r['form_description'],'color'=>$r['color'],'config'=>$record['config'],'items'=>$record['questions']],true);
                    if ($r['closes_at']&&$r['closes_at']<=gmdate('Y-m-d H:i:s'))SurveyInput::fail('La fecha de cierre ya pasó.');
                    $this->query("UPDATE surveys SET status='published',published_at=UTC_TIMESTAMP(),version=version+1 WHERE id=?",[$id]);
                    if ($r['access_mode']==='shared_link')$this->newLink($id,false);
                } elseif ($action==='close'&&$r['status']==='published')$this->query("UPDATE surveys SET status='closed',version=version+1 WHERE id=?",[$id]);
                elseif ($action==='reopen'&&$r['status']==='closed') {
                    if (($r['closes_at']&&$r['closes_at']<=gmdate('Y-m-d H:i:s'))||($r['response_limit']!==null&&$this->count($id)>=(int)$r['response_limit']))SurveyInput::fail('Ampliá el plazo o cupo antes de reabrir.');
                    $this->query("UPDATE surveys SET status='published',version=version+1 WHERE id=?",[$id]);
                } else throw new ApiException(409,'INVALID_STATE','Cambio de estado no válido.');
            }
            $this->users->audit($actor,'survey.'.$action,$id,$GLOBALS['request_id']);$this->db->commit();return $this->get($actor,$id);
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
    private function rawToken(array $link): string { return hash_hmac('sha256','survey-link:'.$link['id'].':'.$link['nonce'],$this->config['app_key']); }
    private function newLink(string $id,bool $single): void
    {
        $this->query('INSERT INTO survey_links (survey_id,nonce,single_use) VALUES (?,?,?)',[$id,bin2hex(random_bytes(16)),(int)$single]);$lid=$this->db->lastInsertId();$row=$this->query('SELECT * FROM survey_links WHERE id=?',[$lid])->fetch();$this->query('UPDATE survey_links SET token_hash=? WHERE id=?',[hash('sha256',$this->rawToken($row)),$lid]);
    }
    public function links(string $actor,string $id): array
    {
        $r=$this->row($actor,$id);$links=$this->query('SELECT * FROM survey_links WHERE survey_id=? ORDER BY id DESC',[$id])->fetchAll();
        return array_map(fn($l)=>['id'=>(string)$l['id'],'single_use'=>(bool)$l['single_use'],'used_at'=>UserRepository::date($l['used_at']),'revoked_at'=>UserRepository::date($l['revoked_at']),'created_at'=>UserRepository::date($l['created_at']),'token'=>$l['revoked_at']?null:$this->rawToken($l)],$links);
    }
    public function changeLink(string $actor,string $id,$version,?string $linkId): array
    {
        $this->db->beginTransaction();try {
            $this->actor($actor);$r=$this->row($actor,$id,true);$this->version($r,$version);
            if (!$r['published_at']||$r['archived_at'])throw new ApiException(409,'INVALID_STATE','Publicá la encuesta antes de generar enlaces.');
            if ($linkId!==null) { $l=$this->query('SELECT * FROM survey_links WHERE id=? AND survey_id=? FOR UPDATE',[$linkId,$id])->fetch();if (!$l)throw new ApiException(404,'LINK_NOT_FOUND','No se encontró la invitación.');$this->query('UPDATE survey_links SET revoked_at=UTC_TIMESTAMP() WHERE id=?',[$linkId]);if (!$l['single_use'])$this->newLink($id,false); }
            elseif ($r['access_mode']==='individual_link')$this->newLink($id,true);
            else throw new ApiException(409,'SHARED_LINK_EXISTS','El enlace compartido ya existe.');
            $this->query('UPDATE surveys SET version=version+1 WHERE id=?',[$id]);$this->users->audit($actor,$linkId?'survey.link_revoked':'survey.link_created',$id,$GLOBALS['request_id']);$this->db->commit();return ['survey'=>$this->get($actor,$id),'links'=>$this->links($actor,$id)];
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
    private function link(string $token): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/',$token))throw new ApiException(404,'SURVEY_NOT_FOUND','No se encontró la encuesta.');
        $l=$this->query('SELECT * FROM survey_links WHERE token_hash=?',[hash('sha256',$token)])->fetch();if (!$l)throw new ApiException(404,'SURVEY_NOT_FOUND','No se encontró la encuesta.');return $l;
    }
    private function available(array $s,array $l): void
    {
        if ($s['archived_at']||$l['revoked_at'])throw new ApiException(404,'SURVEY_NOT_FOUND','No se encontró la encuesta.');
        if ($s['status']!=='published'||($s['opens_at']&&$s['opens_at']>gmdate('Y-m-d H:i:s'))||($s['closes_at']&&$s['closes_at']<=gmdate('Y-m-d H:i:s'))||($s['response_limit']!==null&&$this->count((string)$s['id'])>=(int)$s['response_limit']))throw new ApiException(409,'SURVEY_UNAVAILABLE','La encuesta no está recibiendo respuestas.');
        if ($l['single_use']&&$l['used_at'])throw new ApiException(409,'INVITATION_USED','Esta invitación ya fue respondida.');
    }
    public function publicGet(string $token): array
    {
        $l=$this->link($token);$s=$this->query('SELECT * FROM surveys WHERE id=?',[$l['survey_id']])->fetch();$this->available($s,$l);
        $nonce=bin2hex(random_bytes(24));$submit=$nonce.'.'.hash_hmac('sha256',$l['token_hash'].':'.$s['version'].':'.$nonce,$this->config['app_key']);
        return ['title'=>$s['form_title'],'description'=>$s['form_description'],'color'=>$s['color'],'identity'=>$s['identity_mode'],'audience'=>$s['audience'],'questions'=>$this->items((string)$s['id']),'version'=>(int)$s['version'],'submit_token'=>$submit,'csrf_token'=>\Hospital\Security\Csrf::token()];
    }
    public function audience(string $token): string { $l=$this->link($token);return (string)$this->query('SELECT audience FROM surveys WHERE id=?',[$l['survey_id']])->fetchColumn(); }
    public function submit(string $token,array $input): array
    {
        $l=$this->link($token);$this->db->beginTransaction();try {
            $s=$this->query('SELECT * FROM surveys WHERE id=? FOR UPDATE',[$l['survey_id']])->fetch();$l=$this->query('SELECT * FROM survey_links WHERE id=? FOR UPDATE',[$l['id']])->fetch();
            $version=SurveyInput::integer($input['version']??null,1,2147483647);$submit=$input['submit_token']??'';
            if (!is_string($submit)||!preg_match('/^([a-f0-9]{48})\.([a-f0-9]{64})$/',$submit,$match)||!hash_equals(hash_hmac('sha256',$l['token_hash'].':'.$version.':'.$match[1],$this->config['app_key']),$match[2]))throw new ApiException(403,'INVALID_SUBMISSION','Volvé a abrir la encuesta.');
            [$answers,$name]=SurveyInput::answers($this->items((string)$s['id']),$input['answers']??null,$input['participant_name']??'',$s['identity_mode']);$payload=hash('sha256',json_encode([$answers,$name],JSON_THROW_ON_ERROR));$hash=hash('sha256',$submit);
            $prior=$this->query('SELECT * FROM survey_responses WHERE submit_hash=?',[$hash])->fetch();
            if ($prior) { if ($prior['payload_hash']!==$payload)throw new ApiException(409,'SUBMISSION_CHANGED','Estas respuestas ya fueron enviadas.');$this->db->commit();return ['accepted'=>true,'completion_message'=>$s['completion_message'],'replayed'=>true]; }
            $this->available($s,$l);$this->version($s,$version);
            $this->query('INSERT INTO survey_responses (survey_id,link_id,submit_hash,payload_hash,survey_version,participant_name) VALUES (?,?,?,?,?,?)',[$s['id'],$l['id'],$hash,$payload,$version,$name]);$rid=$this->db->lastInsertId();
            foreach ($answers as $key=>$answer)$this->query('INSERT INTO survey_answers (response_id,item_id,answer) SELECT ?,id,? FROM survey_items WHERE survey_id=? AND item_key=?',[$rid,json_encode($answer,JSON_THROW_ON_ERROR),$s['id'],$key]);
            if ($l['single_use'])$this->query('UPDATE survey_links SET used_at=UTC_TIMESTAMP() WHERE id=?',[$l['id']]);
            $this->query('UPDATE surveys SET updated_at=UTC_TIMESTAMP() WHERE id=?',[$s['id']]);$this->users->audit(null,'survey.responded',(string)$s['id'],$GLOBALS['request_id']);$this->db->commit();return ['accepted'=>true,'completion_message'=>$s['completion_message'],'replayed'=>false];
        } catch (\Throwable $e) { if ($this->db->inTransaction())$this->db->rollBack();throw $e; }
    }
    private function results(string $id,array $questions,int $responses): array
    {
        $result=[];foreach ($questions as $q) {
            if (in_array($q['type'],['section','divider'],true))continue;
            $rows=$this->query('SELECT a.answer,COUNT(*) AS n FROM survey_answers a JOIN survey_items i ON i.id=a.item_id WHERE i.survey_id=? AND i.item_key=? GROUP BY a.answer',[$id,$q['id']])->fetchAll();$n=0;$bins=[];
            if (in_array($q['type'],['single_choice','multiple_choice'],true))foreach ($q['options'] as $v)$bins[$v]=0;
            if ($q['other'])$bins['Otro']=0;
            if (in_array($q['type'],['rating','linear_scale'],true))for ($v=$q['type']==='rating'?1:$q['scale_min'];$v<=($q['type']==='rating'?$q['rating_max']:$q['scale_max']);$v++)$bins[$v]=0;
            foreach ($rows as $row) { $value=json_decode($row['answer'],true,32,JSON_THROW_ON_ERROR);$count=(int)$row['n'];$n+=$count;
                if (is_array($value))foreach ($value['choices'] as $v){$label=$v==='other'?'Otro':$q['options'][(int)$v];$bins[$label]=($bins[$label]??0)+$count;}
                elseif (in_array($q['type'],['rating','linear_scale'],true))$bins[$value]=($bins[$value]??0)+$count;
            }
            $distribution=[];foreach ($bins as $value=>$count)$distribution[]=['value'=>$value,'count'=>$count];$result[$q['id']]=['answer_count'=>$n,'skipped_count'=>$responses-$n,'distribution'=>$distribution];
        }return $result;
    }
    public function entries(string $actor,string $id,string $key,string $search,int $page,int $size): array
    {
        $this->row($actor,$id);$q=$this->query('SELECT * FROM survey_items WHERE survey_id=? AND item_key=?',[$id,$key])->fetch();if (!$q)throw new ApiException(404,'QUESTION_NOT_FOUND','No se encontró la pregunta.');
        $choice=in_array($q['type'],['single_choice','multiple_choice'],true);$expression=$choice?"JSON_UNQUOTE(JSON_EXTRACT(a.answer,'$.other_text'))":"JSON_UNQUOTE(a.answer)";
        if (!in_array($q['type'],['short_text','long_text','date','single_choice','multiple_choice'],true))SurveyInput::fail('Esta pregunta no tiene respuestas escritas.');
        $where='a.item_id=?';$params=[$q['id']];if ($choice)$where.=' AND '.$expression."<>''";
        if ($search!==''){$where.=' AND '.$expression." LIKE ? ESCAPE '!'";$params[]='%'.strtr($search,['!'=>'!!','%'=>'!%','_'=>'!_']).'%';}
        $total=(int)$this->query('SELECT COUNT(*) FROM survey_answers a WHERE '.$where,$params)->fetchColumn();
        $rows=$this->query('SELECT '.$expression.' AS value,r.submitted_at,r.participant_name FROM survey_answers a JOIN survey_responses r ON r.id=a.response_id WHERE '.$where.' ORDER BY r.id DESC LIMIT '.$size.' OFFSET '.(($page-1)*$size),$params)->fetchAll();
        foreach ($rows as &$row)$row['submitted_at']=UserRepository::date($row['submitted_at']);unset($row);return [$rows,$total];
    }
}
