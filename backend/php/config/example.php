<?php
// Copy to local.php (ignored by Git), or use HOSPITAL_* environment variables.
return [
    'app_key' => 'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
    'base_path' => '', // For example '/hospital' when mounted under a subdirectory.
    'secure_cookies' => false, // true with HTTPS; false only for local HTTP development.
    'session_idle_seconds' => 1800,
    'session_absolute_seconds' => 28800,
    'bcrypt_cost' => 12,
    'storage_path' => dirname(__DIR__, 3) . '/storage', // Private writable directory, outside public/.
    'document_scanner' => '', // Optional absolute path to local clamscan; configured scans fail closed.
    'route_mapping_enabled' => true, // User-triggered cached demo address/road lookup; saves remain usable offline.
    'geocoder_url' => 'https://photon.komoot.io/api/',
    'router_url' => 'https://router.project-osrm.org/route/v1/driving',
    'unmapped_duration_seconds' => 3600, // Conservative booking interval only; not a displayed ETA.
    'map_country' => 'UY',
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'socket' => '',
        'name' => 'hospital',
        'user' => 'hospital_app',
        'password' => 'REPLACE_WITH_YOUR_LOCAL_DATABASE_PASSWORD',
    ],
];
