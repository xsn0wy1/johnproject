<?php
declare(strict_types=1);
namespace Hospital\Modules\Surveys;
use Hospital\Http\ApiException;

final class SurveyInput
{
    public const FIELDS=['title','description','category','area','notes','form_title','form_description','color','config','items'];
    public const TYPES=['short_text','long_text','single_choice','multiple_choice','linear_scale','rating','date','section','divider'];
    public static function fail(string $message): void { throw new ApiException(422,'VALIDATION_FAILED',$message); }
    public static function text($value,int $max,bool $required=false): string
    {
        if (!is_string($value)||!mb_check_encoding($value,'UTF-8')||preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/',$value)) self::fail(\Hospital\I18n::t("errors.texto_no_valido"));
        $value=trim($value);if (mb_strlen($value)>$max||($required&&$value==='')) self::fail(\Hospital\I18n::t("errors.completa_los_campos_y_respeta_sus_limites"));return $value;
    }
    public static function choice($value,array $choices): string
    { if (!is_string($value)||!in_array($value,$choices,true)) self::fail(\Hospital\I18n::t("errors.opcion_no_valida"));return $value; }
    public static function flag($value): bool { if (!is_bool($value)) self::fail(\Hospital\I18n::t("errors.se_esperaba_un_valor_booleano"));return $value; }
    public static function integer($value,int $min,int $max): int
    { if ((!is_int($value)&&!(is_string($value)&&preg_match('/^\d+$/',$value)))||$value<$min||$value>$max) self::fail(\Hospital\I18n::t("errors.numero_fuera_de_rango"));return (int)$value; }
    private static function date($value): string
    {
        $value=self::text($value,16,true);$date=\DateTimeImmutable::createFromFormat('!Y-m-d\TH:i',$value,new \DateTimeZone('America/Montevideo'));
        if (!$date||$date->format('Y-m-d\TH:i')!==$value||$date->format('Y')<'1900'||$date->format('Y')>'2200') self::fail(\Hospital\I18n::t("errors.fecha_no_valida"));
        return $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }
    public static function fields(array $input,bool $publish=false): array
    {
        $config=$input['config']??null;$items=$input['items']??null;
        $keys=['audience','access','identity','limit_enabled','response_limit','opens_enabled','opens_at','closes_enabled','closes_at','completion_message'];
        if (!is_array($config)||array_diff(array_keys($config),$keys)||!is_array($items)||array_values($items)!==$items||count($items)>20) self::fail(\Hospital\I18n::t("errors.configuracion_o_preguntas_no_validas"));
        $limit=self::flag($config['limit_enabled']??false)?self::integer($config['response_limit']??null,1,10000):null;
        $opens=self::flag($config['opens_enabled']??false)?self::date($config['opens_at']??null):null;
        $closes=self::flag($config['closes_enabled']??false)?self::date($config['closes_at']??null):null;
        if ($opens&&$closes&&$opens>=$closes) self::fail(\Hospital\I18n::t("errors.el_cierre_debe_ser_posterior_a_la_apertura"));
        $row=[
            'title'=>self::text($input['title']??null,120,true),'description'=>self::text($input['description']??'',500),
            'category'=>self::choice($input['category']??null,['patient_care','transfers','emergency','staff','other']),
            'area'=>self::text($input['area']??'',80),'notes'=>self::text($input['notes']??'',400),
            'form_title'=>self::text($input['form_title']??'',150,$publish),'form_description'=>self::text($input['form_description']??'',500),
            'color'=>self::choice($input['color']??'blue',['blue','green','cyan','amber','rose','slate']),
            'audience'=>self::choice($config['audience']??null,['patients','staff','everyone']),
            'access_mode'=>self::choice($config['access']??null,['shared_link','individual_link']),
            'identity_mode'=>self::choice($config['identity']??null,['anonymous','optional_name']),
            'response_limit'=>$limit,'opens_at'=>$opens,'closes_at'=>$closes,'completion_message'=>self::text($config['completion_message']??'',500)
        ];
        $clean=[];$seen=[];$questions=0;
        foreach ($items as $item) {
            $allowed=['id','type','title','required','options','other','description','placeholder','scale_min','scale_max','scale_start','scale_end','rating_max'];
            if (!is_array($item)||array_diff(array_keys($item),$allowed)) self::fail(\Hospital\I18n::t("errors.pregunta_no_valida"));
            $id=$item['id']??null;if (!is_string($id)||!preg_match('/^[A-Za-z0-9_-]{1,48}$/',$id)||isset($seen[$id])) self::fail(\Hospital\I18n::t("errors.identificador_de_pregunta_no_valido"));$seen[$id]=true;
            $type=self::choice($item['type']??null,self::TYPES);$element=in_array($type,['section','divider'],true);$choice=in_array($type,['single_choice','multiple_choice'],true);
            $options=$item['options']??[];if (!is_array($options)||array_values($options)!==$options||($choice&&(count($options)<2||count($options)>10))) self::fail(\Hospital\I18n::t("errors.usa_entre_2_y_10_opciones"));
            $options=$choice?array_map(static fn($v)=>self::text($v,120,$publish),$options):[];
            if ($choice&&$publish&&($item['other']??false)&&in_array('otro',array_map(static fn($v)=>mb_strtolower($v),$options),true)) self::fail(\Hospital\I18n::t("errors.usa_otra_etiqueta_para_distinguir_la_opcion_otro"));
            if ($choice&&$publish&&count(array_unique(array_map(static fn($v)=>mb_strtolower($v),$options)))!==count($options)) self::fail(\Hospital\I18n::t("errors.las_opciones_deben_ser_diferentes"));
            $clean[]=['id'=>$id,'type'=>$type,'title'=>self::text($item['title']??'',250,$publish&&$type!=='divider'),
                'required'=>$element?false:self::flag($item['required']??false),'options'=>$options,'other'=>$choice?self::flag($item['other']??false):false,
                'description'=>$type==='section'?self::text($item['description']??'',500):'',
                'placeholder'=>in_array($type,['short_text','long_text'],true)?self::text($item['placeholder']??'',120):'',
                'scale_min'=>$type==='linear_scale'?self::integer($item['scale_min']??1,0,1):1,
                'scale_max'=>$type==='linear_scale'?self::integer($item['scale_max']??5,2,10):5,
                'scale_start'=>$type==='linear_scale'?self::text($item['scale_start']??'',40):'',
                'scale_end'=>$type==='linear_scale'?self::text($item['scale_end']??'',40):'',
                'rating_max'=>$type==='rating'?self::integer($item['rating_max']??5,3,10):5];
            if ($type==='rating'&&!in_array(end($clean)['rating_max'],[3,5,10],true)) self::fail(\Hospital\I18n::t("errors.calificacion_no_valida"));
            if (!$element)$questions++;
        }
        if ($publish&&!$questions) self::fail(\Hospital\I18n::t("errors.agrega_al_menos_una_pregunta"));
        return [$row,$clean];
    }
    public static function answers(array $items,$input,$name,string $identity): array
    {
        if (!is_array($input)||array_values($input)!==$input||count($input)>20) self::fail(\Hospital\I18n::t("errors.respuestas_no_validas"));
        $byKey=[];foreach ($items as $item) if (!in_array($item['type'],['section','divider'],true))$byKey[$item['id']]=$item;
        $answers=[];
        foreach ($input as $entry) {
            if (!is_array($entry)||array_diff(array_keys($entry),['question_id','value','other_text'])) self::fail(\Hospital\I18n::t("errors.respuesta_no_valida"));
            $key=$entry['question_id']??null;if (!is_string($key)||!isset($byKey[$key])||isset($answers[$key])) self::fail(\Hospital\I18n::t("errors.pregunta_desconocida_o_repetida"));
            $q=$byKey[$key];$value=$entry['value']??null;$other=$entry['other_text']??'';
            if (in_array($q['type'],['single_choice','multiple_choice'],true)) {
                $values=$q['type']==='single_choice'?[$value]:$value;
                if (!is_array($values)||array_values($values)!==$values||!count($values)||count($values)>11)self::fail(\Hospital\I18n::t("errors.selecciona_opciones_validas"));
                $chosen=[];foreach ($values as $v) {
                    if ($v==='other'&&$q['other'])$chosen[]='other';
                    else $chosen[]=(string)self::integer($v,0,count($q['options'])-1);
                }
                if (count(array_unique($chosen))!==count($chosen)) self::fail(\Hospital\I18n::t("errors.opcion_repetida"));sort($chosen,SORT_STRING);
                $value=['choices'=>$chosen,'other_text'=>in_array('other',$chosen,true)?self::text($other,120,true):''];
                if ($other!==''&&!in_array('other',$chosen,true))self::fail(\Hospital\I18n::t("errors.la_respuesta_otro_no_corresponde"));
            } elseif (in_array($q['type'],['rating','linear_scale'],true)) $value=self::integer($value,$q['type']==='rating'?1:$q['scale_min'],$q['type']==='rating'?$q['rating_max']:$q['scale_max']);
            else {
                $value=self::text($value,$q['type']==='long_text'?1000:250,true);
                if ($q['type']==='date') { $date=\DateTimeImmutable::createFromFormat('!Y-m-d',$value);if (!$date||$date->format('Y-m-d')!==$value||$date->format('Y')<'1900'||$date->format('Y')>'2200')self::fail(\Hospital\I18n::t("errors.fecha_no_valida")); }
            }
            if (!in_array($q['type'],['single_choice','multiple_choice'],true)&&$other!=='')self::fail(\Hospital\I18n::t("errors.campo_otro_no_permitido"));
            $answers[$key]=$value;
        }
        foreach ($byKey as $key=>$q) if ($q['required']&&!array_key_exists($key,$answers))self::fail(\Hospital\I18n::t("survey_patient.completa_las_preguntas_obligatorias"));
        $name=self::text($name??'',100);if ($identity==='anonymous'&&$name!=='')self::fail(\Hospital\I18n::t("errors.esta_encuesta_no_solicita_nombre"));
        ksort($answers);return [$answers,$name===''?null:$name];
    }
}
