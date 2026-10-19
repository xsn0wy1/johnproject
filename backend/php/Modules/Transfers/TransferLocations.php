<?php
declare(strict_types=1);
namespace Hospital\Modules\Transfers;
use Hospital\Http\ApiException;

final class TransferLocations
{
    private \PDO $db;
    private array $config;
    public function __construct(\PDO $db,array $config=[]) { $this->db=$db; $this->config=$config; }
    public static function fingerprint(array $resolved): string
    {
        $r=$resolved['route'];
        return hash('sha256',json_encode([$resolved['origin'],$resolved['destination'],$r['id'],$r['geometry'],$r['distance_meters'],$r['duration_seconds'],$r['route_snapshot']??null],JSON_THROW_ON_ERROR));
    }
    public function resolve(array $fields,?array $existing,bool $lock=true,bool $refresh=false): array
    {
        $explicit=array_key_exists('route_template_id',$fields);
        $selected=$fields['route_template_id']??null;
        $keepSelected=!$refresh && $existing && $explicit && $selected===($existing['route_template_id']===null?null:(string)$existing['route_template_id']);
        if ($selected!==null && $keepSelected) {
            $ends=[]; foreach (['origin','destination'] as $key) $ends[$key]=['id'=>$existing[$key.'_facility_id'],'name'=>$existing[$key.'_name'],'address'=>$existing[$key.'_address']];
            $route=['id'=>$existing['route_template_id'],'geometry'=>$existing['geometry'],'distance_meters'=>$existing['distance_meters'],'duration_seconds'=>$existing['duration_seconds'],'route_snapshot'=>$existing['route_snapshot']??null];
            return ['origin'=>$ends['origin'],'destination'=>$ends['destination'],'route'=>$route,'sameRoute'=>true];
        }
        if ($selected!==null && !$keepSelected) {
            $s=$this->db->prepare("SELECT * FROM route_templates WHERE id=? AND status='active' AND availability='active'".($lock?' FOR UPDATE':'')); $s->execute([$selected]); $route=$s->fetch();
            if (!$route) throw new ApiException(422,'ROUTE_UNAVAILABLE',\Hospital\I18n::t("errors.selecciona_una_ruta_activa_o_escribi_el_recorrido_manualmente"));
            if (isset($fields['route_version']) && (int)$route['version']!==$fields['route_version']) throw new ApiException(409,'VERSION_CONFLICT',\Hospital\I18n::t("errors.la_ruta_cambio_volve_a_seleccionarla"));
            $payload=(new \Hospital\Modules\Routes\RouteService($this->db,$this->config))->payload($route);
            $route['route_snapshot']=json_encode(array_intersect_key($payload,array_flip(['id','code','name','category','direction','stops','version'])),JSON_THROW_ON_ERROR);
            $ends=[]; foreach (['origin','destination'] as $key) $ends[$key]=['id'=>$route[$key.'_facility_id'],'name'=>$route[$key.'_name'],'address'=>$route[$key.'_address']];
            return ['origin'=>$ends['origin'],'destination'=>$ends['destination'],'route'=>$route,'sameRoute'=>false];
        }
        $ends=[]; $sameRoute=$existing!==null && !$refresh;
        if ($explicit && !$keepSelected) $sameRoute=false;
        foreach (['origin','destination'] as $key) {
            $id=$fields[$key.'_facility_id'];
            $same=$existing && $id===($existing[$key.'_facility_id']===null?null:(string)$existing[$key.'_facility_id']);
            if ($id===null) $same=$same && $fields[$key.'_name']===$existing[$key.'_name'] && $fields[$key.'_address']===$existing[$key.'_address'];
            $sameRoute=$sameRoute && $same;
            if ($same) {
                $ends[$key]=['id'=>$id,'name'=>$existing[$key.'_name'],'address'=>$existing[$key.'_address']];
            } elseif ($id!==null) {
                $s=$this->db->prepare("SELECT * FROM facilities WHERE id=? AND status='active' AND availability='active'".($lock?' FOR UPDATE':'')); $s->execute([$id]); $center=$s->fetch();
                if (!$center) throw new ApiException(422,'FACILITY_UNAVAILABLE',\Hospital\I18n::t("errors.selecciona_un_centro_activo_o_escribi_una_ubicacion_propia"));
                $ends[$key]=$center;
            } else {
                $ends[$key]=['id'=>null,'name'=>$fields[$key.'_name'],'address'=>$fields[$key.'_address']];
            }
        }
        $route=['id'=>null,'geometry'=>'[]','distance_meters'=>null,'duration_seconds'=>null,'route_snapshot'=>null];
        if ($sameRoute) {
            $route=['id'=>$existing['route_template_id'],'geometry'=>$existing['geometry'],'distance_meters'=>$existing['distance_meters'],'duration_seconds'=>$existing['duration_seconds'],'route_snapshot'=>$existing['route_snapshot']??null];
        } elseif (!$explicit && $fields['origin_facility_id']!==null && $fields['destination_facility_id']!==null) {
            $s=$this->db->prepare("SELECT * FROM route_templates WHERE origin_facility_id=? AND destination_facility_id=? AND status='active' AND availability='active' ORDER BY duration_seconds,id LIMIT 1");
            $s->execute([$fields['origin_facility_id'],$fields['destination_facility_id']]); $candidate=$s->fetch();
            if ($candidate) {
                $points=json_decode($candidate['geometry'],true,32,JSON_THROW_ON_ERROR);
                $valid=count($points)>=2;
                if (!$valid) $candidate=null;
                if ($valid) $points=TransferInput::geometry($points)['points'];
                foreach (['origin'=>0,'destination'=>count($points)-1] as $key=>$index) {
                    $center=$ends[$key];
                    // An unchanged endpoint may have used its immutable snapshot above.
                    if (!array_key_exists('latitude',$center)) { $s=$this->db->prepare('SELECT latitude,longitude FROM facilities WHERE id=?'); $s->execute([$center['id']]); $center=$s->fetch(); }
                    if (!$valid || $center['latitude']===null || $center['longitude']===null || TransferInput::distance($center,$points[$index])>100) $valid=false;
                }
                if ($valid) $route=$candidate;
            }
        }
        return ['origin'=>$ends['origin'],'destination'=>$ends['destination'],'route'=>$route,'sameRoute'=>(bool)$sameRoute];
    }
}
