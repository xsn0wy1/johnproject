<?php
declare(strict_types=1);
namespace Hospital\Modules\Doctors;
use Hospital\Http\ApiException;
use Hospital\Modules\Patients\PatientInput;

final class DoctorInput
{
    public const FIELDS = ['title','full_name','national_id','license','specialty','department','office','phone','email','availability','shift','days','start_time','end_time','notes'];
    private static function invalid(string $field): void { throw new ApiException(422,'VALIDATION_FAILED',\Hospital\I18n::t("errors.revisa_los_datos_del_medico"),[$field=>\Hospital\I18n::t("errors.valor_no_valido")]); }
    public static function fields(array $input): array
    {
        foreach (self::FIELDS as $key) if (!array_key_exists($key,$input)) self::invalid($key);
        $f = [];
        foreach (['title'=>8,'full_name'=>100,'license'=>30,'specialty'=>80,'department'=>80,'office'=>80,'email'=>120,'days'=>40] as $key=>$max) {
            $f[$key]=PatientInput::text($input[$key],$key,$max,in_array($key,['office','email'],true));
        }
        if (!in_array($f['title'],['Dr.','Dra.'],true)) self::invalid('title');
        $f['national_id']=PatientInput::identity($input['national_id']);
        $f['license']=strtoupper(preg_replace('/[\s.-]/u','',$f['license']));
        if (!preg_match('/^[A-Z0-9]{2,30}$/',$f['license'])) self::invalid('license');
        $f['phone']=PatientInput::phone($input['phone'],'phone');
        if (strlen(preg_replace('/\D/','',$f['phone']))<8) self::invalid('phone');
        if ($f['email']!=='' && !filter_var($f['email'],FILTER_VALIDATE_EMAIL)) self::invalid('email');
        foreach (['availability'=>['available','consulting','on_call','inactive'],'shift'=>['morning','afternoon','night','rotating'],'days'=>['weekdays','mon_wed_fri','tue_thu','weekends','rotating']] as $key=>$choices) {
            if (!in_array($input[$key],$choices,true)) self::invalid($key);
            $f[$key]=$input[$key];
        }
        foreach (['start_time','end_time'] as $key) {
            $v=$input[$key];
            if ($v!==null && $v!=='' && (!is_string($v) || !preg_match('/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/',$v))) self::invalid($key);
            $f[$key]=$v===''?null:$v;
        }
        if (($f['start_time']===null)!==($f['end_time']===null)) self::invalid('end_time');
        // Overnight shifts are valid. These hours describe the profile, not bookings.
        $notes=$input['notes'];
        if (!is_string($notes) || !mb_check_encoding($notes,'UTF-8')) self::invalid('notes');
        $f['notes']=trim(str_replace(["\r\n","\r"],"\n",$notes));
        if (mb_strlen($f['notes'])>500 || preg_match('/\p{C}/u',str_replace(["\n","\t"],'',$f['notes']))) self::invalid('notes');
        return $f;
    }
}
