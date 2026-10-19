<?php
declare(strict_types=1);
namespace Hospital\Modules\Patients;
use Hospital\Http\ApiException;
use Hospital\Http\Request;
use Hospital\Modules\Settings\SettingsService;

final class PatientInput
{
    public const FIELDS = ['full_name','national_id','date_of_birth','sex','age','phone','blood_group','allergies','emergency_name','emergency_phone','emergency_relationship','care_status','room','department','doctor_staff_id','doctor_specialty','admission_date','diagnosis','clinical_state'];
    public static function today(): string { return (new \DateTimeImmutable('now', new \DateTimeZone('America/Montevideo')))->format('Y-m-d'); }
    public static function text($value, string $field, int $max, bool $empty = true): string { return SettingsService::text($value, $field, $max, $empty); }
    public static function identity($value): string
    {
        if (!is_string($value)) self::invalid('national_id');
        $value = preg_replace('/[.\s-]/u', '', $value);
        if (!preg_match('/^[0-9]{6,12}$/', $value)) self::invalid('national_id');
        return $value;
    }
    public static function invalid(string $field): void { throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.revisa_los_datos_del_paciente"),[$field=>\Hospital\I18n::t("errors.valor_no_valido")]); }
    public static function date($value, string $field): ?string
    {
        if ($value === null || $value === '') return null;
        $date = is_string($value) ? \DateTimeImmutable::createFromFormat('!Y-m-d',$value) : false;
        if (!$date || $date->format('Y-m-d') !== $value || $value < '1900-01-01' || $value > self::today()) self::invalid($field);
        return $value;
    }
    public static function phone($value, string $field): string
    {
        $value = self::text($value,$field,25);
        if ($value !== '' && (!preg_match('/^\+?[0-9 ()-]+$/',$value) || strlen(preg_replace('/\D/','',$value)) < 6 || strlen(preg_replace('/\D/','',$value)) > 20)) self::invalid($field);
        return $value;
    }
    public static function version($value): int
    {
        if ((!is_int($value) && !is_string($value)) || !preg_match('/^[1-9][0-9]{0,9}$/',(string)$value)) throw new ApiException(422,'VERSION_REQUIRED',\Hospital\I18n::t("errors.se_requiere_la_revision_actual"));
        return (int)$value;
    }
    public static function fields(array $input): array
    {
        foreach (self::FIELDS as $key) if (!array_key_exists($key,$input)) throw new ApiException(422,'MISSING_FIELDS',\Hospital\I18n::t("errors.envia_todos_los_campos_del_formulario"));
        $f = ['full_name'=>self::text($input['full_name'],'full_name',150,false),'national_id'=>self::identity($input['national_id']),
            'date_of_birth'=>self::date($input['date_of_birth'],'date_of_birth')];
        $f['sex'] = $input['sex'] === '' ? null : $input['sex'];
        if (!in_array($f['sex'],[null,'female','male','other','unspecified'],true)) self::invalid('sex');
        $age = $input['age'];
        if ($age !== null && $age !== '' && ((!is_int($age) && !is_string($age)) || !preg_match('/^(?:0|[1-9][0-9]{0,2})$/',(string)$age) || (int)$age > 120)) self::invalid('age');
        $f['age'] = $age === null || $age === '' ? null : (int)$age;
        if ($f['date_of_birth'] !== null) {
            if ((new \DateTimeImmutable($f['date_of_birth']))->diff(new \DateTimeImmutable(self::today()))->y > 120) self::invalid('date_of_birth');
            $f['age'] = null; // Never invent a birth date from an observed age.
        }
        $f['phone'] = self::phone($input['phone'],'phone');
        $group = is_string($input['blood_group']) ? strtoupper(trim($input['blood_group'])) : null;
        if ($group === null || !in_array($group,['','A+','A-','B+','B-','AB+','AB-','O+','O-'],true)) self::invalid('blood_group');
        $f['blood_group'] = $group === '' ? null : $group;
        foreach (['allergies'=>100,'emergency_name'=>100,'emergency_relationship'=>50,'room'=>80,'department'=>80,'doctor_specialty'=>80,'clinical_state'=>100] as $key=>$max) $f[$key] = self::text($input[$key],$key,$max);
        $f['emergency_phone'] = self::phone($input['emergency_phone'],'emergency_phone');
        $f['care_status'] = $input['care_status'] === '' ? null : $input['care_status'];
        if (!in_array($f['care_status'],[null,'inpatient','outpatient','emergency','discharged'],true)) self::invalid('care_status');
        $f['doctor_staff_id'] = $input['doctor_staff_id'] === '' || $input['doctor_staff_id'] === null ? null : Request::id($input['doctor_staff_id']);
        $f['admission_date'] = self::date($input['admission_date'],'admission_date');
        $diagnosis = $input['diagnosis'];
        if (!is_string($diagnosis) || !mb_check_encoding($diagnosis,'UTF-8')) self::invalid('diagnosis');
        $diagnosis = trim(str_replace(["\r\n","\r"],"\n",$diagnosis));
        if (mb_strlen($diagnosis)>1000 || preg_match('/\p{C}/u',str_replace(["\n","\t"],'',$diagnosis))) self::invalid('diagnosis');
        $f['diagnosis'] = $diagnosis;
        if ($f['care_status'] === null) {
            foreach (['room','department','doctor_staff_id','doctor_specialty','admission_date','diagnosis','clinical_state'] as $key) if ($f[$key] !== '' && $f[$key] !== null) self::invalid('care_status');
        } elseif ($f['room'] === '' || $f['department'] === '') self::invalid('room');
        return $f;
    }
}
