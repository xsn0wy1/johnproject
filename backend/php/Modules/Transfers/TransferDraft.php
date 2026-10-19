<?php
declare(strict_types=1);
namespace Hospital\Modules\Transfers;
use Hospital\Http\ApiException;
use Hospital\Modules\Auth\UserRepository;

final class TransferDraft
{
    private \PDO $db;
    private TransferAccess $access;
    public function __construct(\PDO $db,array $config){$this->db=$db;$this->access=new TransferAccess($db,$config);}
    public function get(string $actor):array
    {
        $this->access->requireDispatch($actor);$s=$this->db->prepare('SELECT * FROM transfer_drafts WHERE user_id=?');$s->execute([$actor]);$row=$s->fetch();
        $payload=$row?json_decode($row['payload'],true,16,JSON_THROW_ON_ERROR):[];
        return ['version'=>$row?(int)$row['version']:0,'payload'=>$payload?:new \stdClass(),'updated_at'=>$row?UserRepository::date($row['updated_at']):null];
    }
    public function save(string $actor,array $input,bool $clear=false):array
    {
        $payload=$clear?new \stdClass():($input['payload']??null);
        $allowed=['ambulance','driver','companion','startDate','startTime','reason','patientName','patientCedula','patientAge','patientSex','origin','destination','routeTemplate','routeVersion','transferType','priority','notes','specialEquipment','withFamily','interdepartmental','criticalPatient','patientId','createToken'];
        if(!$clear){
            if(!is_array($payload)||array_diff(array_keys($payload),$allowed))throw new ApiException(422,'VALIDATION_FAILED','Borrador no válido.');
            foreach($payload as $key=>$value){
                if(in_array($key,['specialEquipment','withFamily','interdepartmental','criticalPatient'],true)){if(!is_bool($value))throw new ApiException(422,'VALIDATION_FAILED','Opción no válida.');}
                else{if(!is_string($value)||!mb_check_encoding($value,'UTF-8')||mb_strlen($value)>($key==='notes'?1000:255))throw new ApiException(422,'VALIDATION_FAILED','Texto de borrador no válido.');}
            }
        }
        $version=$input['version']??null;if(!is_int($version)||$version<0||$version>4294967295)throw new ApiException(422,'VERSION_REQUIRED','Se requiere la revisión del borrador.');
        $this->access->serialized(function()use($actor,$payload,$version){
            $this->db->beginTransaction();
            try{
                $this->access->actor($actor);$s=$this->db->prepare('SELECT version FROM transfer_drafts WHERE user_id=? FOR UPDATE');$s->execute([$actor]);$old=$s->fetchColumn();
                if(($old===false?0:(int)$old)!==$version)throw new ApiException(409,'VERSION_CONFLICT','El borrador cambió en otra sesión.');
                $s=$this->db->prepare('INSERT INTO transfer_drafts (user_id,payload,version) VALUES (?,?,1) ON DUPLICATE KEY UPDATE payload=VALUES(payload),version=version+1,updated_at=UTC_TIMESTAMP()');$s->execute([$actor,json_encode($payload,JSON_THROW_ON_ERROR)]);
                $this->access->audit($actor,'transfer.draft_saved',null);$this->db->commit();
            }catch(\Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
        });return $this->get($actor);
    }
}
