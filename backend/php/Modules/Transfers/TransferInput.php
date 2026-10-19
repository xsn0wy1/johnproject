<?php
declare(strict_types=1);
namespace Hospital\Modules\Transfers;
use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Settings\SettingsService;

final class TransferInput
{
    public const FIELDS = ['route_template_id','route_version','ambulance_id', 'driver_id', 'companion_id', 'patient_id', 'origin_facility_id', 'destination_facility_id', 'origin_name', 'origin_address', 'destination_name', 'destination_address', 'scheduled_at', 'cargo_type', 'priority', 'reason', 'notes', 'special_equipment', 'with_family', 'interdepartmental', 'critical_patient'];
    public static function choice($value, array $allowed): string
    {
        if (!is_string($value) || !in_array($value, $allowed, true)) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.selecciona_una_opcion_valida"));
        return $value;
    }
    public static function version($value): int
    {
        if ((!is_int($value) && !is_string($value)) || !preg_match('/^[1-9][0-9]{0,9}$/', (string) $value)) throw new ApiException(422, 'VERSION_REQUIRED', \Hospital\I18n::t("errors.se_requiere_la_revision_actual"));
        return (int) $value;
    }
    public static function notes($value): string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.notas_no_validas"));
        $value = trim(str_replace(["\r\n", "\r"], "\n", $value));
        if (mb_strlen($value) > 1000 || preg_match('/\p{C}/u', str_replace(["\n", "\t"], '', $value))) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.revisa_las_notas_y_su_longitud"));
        return $value;
    }
    public static function fields(array $input): array
    {
        $fields = [];
        $route=$input['route_template_id']??null;
        $route=$route===null||$route===''?null:Request::id($route);
        if (array_key_exists('route_template_id',$input)) $fields['route_template_id']=$route===null||$route===''?null:Request::id($route);
        if (isset($input['route_version'])) $fields['route_version']=self::version($input['route_version']);
        foreach (['ambulance_id', 'driver_id'] as $key) $fields[$key] = Request::id($input[$key] ?? null);
        foreach (['companion_id', 'patient_id'] as $key) $fields[$key] = ($input[$key] ?? null) === null || $input[$key] === '' ? null : Request::id($input[$key]);
        foreach (['origin','destination'] as $prefix) {
            $id=$input[$prefix.'_facility_id']??null;
            $fields[$prefix.'_facility_id']=$id===null || $id===''?null:Request::id($id);
            $fields[$prefix.'_name']=$fields[$prefix.'_facility_id']===null?SettingsService::text($input[$prefix.'_name']??($route!==null?'':null),$prefix.'_name',150,$route!==null):'';
            $fields[$prefix.'_address']=$fields[$prefix.'_facility_id']===null?SettingsService::text($input[$prefix.'_address']??'',$prefix.'_address',255):'';
        }
        $sameCenters=$fields['origin_facility_id']!==null && $fields['origin_facility_id']===$fields['destination_facility_id'];
        $sameCustom=$fields['origin_facility_id']===null && $fields['destination_facility_id']===null && mb_strtolower($fields['origin_name'])===mb_strtolower($fields['destination_name']) && mb_strtolower($fields['origin_address'])===mb_strtolower($fields['destination_address']);
        if ($fields['driver_id']===$fields['companion_id'] || ($route===null && ($sameCenters || $sameCustom))) throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.el_origen_y_destino_y_los_integrantes_del_equipo_deben_ser_diferentes"));
        $fields['cargo_type'] = self::choice($input['cargo_type'] ?? null, ['patient', 'biological', 'equipment']);
        $fields['priority'] = self::choice($input['priority'] ?? null, ['low', 'normal', 'high', 'critical']);
        $fields['reason'] = self::choice($input['reason'] ?? null, ['consulta', 'estudio', 'alta', 'emergencia', 'insumos']);
        if (($fields['cargo_type'] === 'patient') !== ($fields['patient_id'] !== null)) throw new ApiException(422, 'PATIENT_REQUIRED', \Hospital\I18n::t("errors.solo_un_traslado_de_paciente_debe_tener_un_paciente_del_catalogo"));
        $scheduled = $input['scheduled_at'] ?? null;
        $date = is_string($scheduled) ? \DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:sP', $scheduled) : false;
        if (!$date || $date->format('Y-m-d\TH:i:sP') !== $scheduled || $date->format('P') !== '-03:00' || (int) $date->format('Y') < 2020) throw new ApiException(422, 'INVALID_SCHEDULE', \Hospital\I18n::t("errors.usa_fecha_y_hora_de_montevideo_con_zona_03_00"));
        $fields['scheduled_at'] = $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        $fields['notes'] = self::notes($input['notes'] ?? '');
        foreach (['special_equipment', 'with_family', 'interdepartmental', 'critical_patient'] as $key) {
            $value = $input[$key] ?? false;
            if (!is_bool($value)) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.las_opciones_deben_ser_booleanas"));
            $fields[$key] = (int) $value;
        }
        if ($fields['cargo_type'] !== 'patient' && ($fields['with_family'] || $fields['critical_patient'])) throw new ApiException(422, 'VALIDATION_FAILED', \Hospital\I18n::t("errors.las_opciones_de_paciente_requieren_un_traslado_de_paciente"));
        return $fields;
    }
    public static function geometry($points): array
    {
        if (!is_array($points) || count($points) < 2 || count($points) > 1000 || array_keys($points) !== range(0, count($points)-1)) throw new ApiException(422, 'INVALID_ROUTE', \Hospital\I18n::t("errors.ruta_no_valida"));
        $distance = 0; $previous = null;
        foreach ($points as &$point) {
            if (!is_array($point) || count($point) !== 2 || !isset($point['latitude'], $point['longitude'])) throw new ApiException(422, 'INVALID_ROUTE', \Hospital\I18n::t("errors.coordenadas_no_validas"));
            foreach (['latitude'=>90, 'longitude'=>180] as $key=>$limit) {
                if ((!is_int($point[$key]) && !is_float($point[$key])) || !is_finite((float)$point[$key]) || abs($point[$key])>$limit) throw new ApiException(422, 'INVALID_ROUTE', \Hospital\I18n::t("errors.coordenadas_no_validas"));
                $point[$key] = round((float)$point[$key], 7);
            }
            if ($previous) $distance += self::distance($previous, $point);
            $previous = $point;
        }
        unset($point);
        if ($distance < 1) throw new ApiException(422, 'INVALID_ROUTE', \Hospital\I18n::t("errors.la_ruta_debe_tener_distancia"));
        return ['points'=>$points, 'distance'=>(int)round($distance)];
    }
    public static function distance(array $a, array $b): float
    {
        $dlat=deg2rad($b['latitude']-$a['latitude']); $dlng=deg2rad($b['longitude']-$a['longitude']);
        $h=sin($dlat/2)**2+cos(deg2rad((float)$a['latitude']))*cos(deg2rad((float)$b['latitude']))*sin($dlng/2)**2;
        return 6371000*2*asin(min(1,sqrt($h)));
    }
}
