package main;

use strict;
use warnings;
use Encode qw(encode decode FB_CROAK);
use JSON::PP ();
use POSIX qw(strftime);
use Time::Local qw(timegm timelocal);

my $weatherJSON = JSON::PP->new->utf8->canonical;
my $weatherTTL = 900;
my $weatherRetry = 30;
my $weatherLimit = 96;
my %weatherColors = (minor => '#ffeb3b', moderate => '#fb923c', severe => '#ef4444', extreme => '#a855f7');
my %weatherIcons = map { $_ => 1 } qw(clear-day clear-night partly-cloudy-day partly-cloudy-night cloudy fog drizzle rain snow sleet hail thunderstorm wind);

sub FHEMCMS_WeatherNumber {
    my ($v) = @_;
    return undef if (!defined($v) || ref($v) || $v !~ /\A-?[0-9]{1,9}(?:\.[0-9]{1,30})?\z/);
    return 0 + $v;
}

sub FHEMCMS_WeatherCoords {
    my ($lat, $lon) = map { FHEMCMS_WeatherNumber($_) } @_;
    return if (!defined($lat) || !defined($lon) || abs($lat) > 90 || abs($lon) > 180);
    return ($lat, $lon);
}

sub FHEMCMS_WeatherText {
    my ($value, $max) = @_;
    return '' if (!defined($value) || ref($value));
    $value =~ s/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]//g;
    return substr($value, 0, $max);
}

sub FHEMCMS_ValidateWeather {
    my ($config, $exact) = @_;
    my $err = $exact->($config, 'Wetterkonfiguration', ['dataSource'],
        [qw(location device customTitle forecastDays showAlertsBanner showCurrentDetails enableDetailPopup)]);
    return $err if ($err);
    my $source = $config->{dataSource} // '';
    return 'Ungueltige Wetter-Datenquelle' if (ref($source) || ($source ne 'fhem_dwd' && $source ne 'brightsky'));
    my $scalar = JSON::PP->new->allow_nonref;
    if ($source eq 'brightsky') {
        return 'Wetter-Device und Ort schliessen sich aus' if (exists($config->{device}));
        my $location = $config->{location};
        $err = $exact->($location, 'Wetterort', [qw(name lat lon country)], ['admin1']);
        return $err if ($err);
        my @coords = FHEMCMS_WeatherCoords(@{$location}{qw(lat lon)});
        return 'Ungueltige Wetter-Koordinaten' if (!@coords || grep { $scalar->encode($_) =~ /\A"/ } @{$location}{qw(lat lon)});
        return 'Ungueltiger Wetter-Ortsname' if (!defined($location->{name}) || ref($location->{name})
            || $location->{name} !~ /\A[^\x00-\x1f\x7f]{1,120}\z/);
        return 'Ungueltige Wetter-Region' if (exists($location->{admin1}) && (!defined($location->{admin1})
            || ref($location->{admin1}) || $location->{admin1} !~ /\A[^\x00-\x1f\x7f]{0,120}\z/));
        return 'Ungueltiger Wetter-Laendercode' if (!defined($location->{country})
            || ref($location->{country}) || $location->{country} !~ /\A[A-Z]{2}\z/);
    } else {
        return 'Ungueltiges Wetter-Device' if (exists($config->{location}) || ref($config->{device}) || !FHEMCMS_ValidName($config->{device}));
    }
    return 'Ungueltiger Wetter-Titel' if (exists($config->{customTitle}) && (!defined($config->{customTitle})
        || ref($config->{customTitle}) || $config->{customTitle} !~ /\A[^\x00-\x1f\x7f]{0,64}\z/));
    return 'Ungueltige Anzahl Wetter-Vorhersagetage' if (exists($config->{forecastDays})
        && $scalar->encode($config->{forecastDays}) !~ /\A[0-8]\z/);
    for my $field (qw(showAlertsBanner showCurrentDetails enableDetailPopup)) {
        return "Ungueltiger Wert fuer $field" if (exists($config->{$field}) && !JSON::PP::is_bool($config->{$field}));
    }
    return undef;
}

sub FHEMCMS_WeatherEpoch {
    my ($stamp) = @_;
    return undef if (!defined($stamp) || ref($stamp)
        || $stamp !~ /\A(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))?\z/);
    my ($year, $month, $day, $hour, $minute, $second, $zone, $sign, $zoneHour, $zoneMinute) =
        ($1, $2, $3, $4, $5, $6 // 0, $7, $8, $9, $10);
    return undef if (defined($sign) && ($zoneHour > 23 || $zoneMinute > 59));
    my @parts = ($second, $minute, $hour, $day, $month - 1, $year);
    my $epoch = eval { defined($zone) ? timegm(@parts) : timelocal(@parts) };
    return undef if (!defined($epoch));
    return $epoch - (defined($sign) ? ($sign eq '-' ? -1 : 1) * ($zoneHour * 3600 + $zoneMinute * 60) : 0);
}

sub FHEMCMS_WeatherISO {
    my ($epoch) = @_;
    return strftime('%Y-%m-%dT%H:%M:%SZ', gmtime($epoch));
}

sub FHEMCMS_WeatherIcon {
    my ($ww, $day) = @_;
    return undef if (!defined($ww) || $ww !~ /\A[0-9]{1,2}\z/);
    return $day ? 'clear-day' : 'clear-night' if ($ww < 2);
    return $day ? 'partly-cloudy-day' : 'partly-cloudy-night' if ($ww == 2);
    return 'cloudy' if ($ww == 3);
    return 'thunderstorm' if ($ww >= 91 || $ww == 17 || $ww == 29);
    return 'sleet' if ($ww == 68 || $ww == 69 || ($ww >= 87 && $ww <= 90) || $ww == 23 || $ww == 24);
    return 'snow' if (($ww >= 70 && $ww <= 79) || ($ww >= 83 && $ww <= 86) || $ww == 22 || $ww == 26);
    return 'drizzle' if (($ww >= 50 && $ww <= 59) || $ww == 20);
    return 'rain' if (($ww >= 60 && $ww <= 67) || ($ww >= 80 && $ww <= 82) || $ww == 21 || $ww == 25);
    return 'fog' if (($ww >= 4 && $ww <= 12) || ($ww >= 40 && $ww <= 49) || $ww == 28);
    return undef;
}

sub FHEMCMS_WeatherBrightRow {
    my ($raw, $current) = @_;
    return undef if (ref($raw) ne 'HASH' || !defined(FHEMCMS_WeatherEpoch($raw->{timestamp})));
    my %row = (timestamp => $raw->{timestamp});
    my %keys = (temp => 'temperature', dewPoint => 'dew_point', humidity => 'relative_humidity',
        pressure => 'pressure_msl', cloudCover => 'cloud_cover', visibility => 'visibility',
        wwCode => 'ww', precipitationProbability => 'precipitation_probability');
    my $suffix = $current ? '_60' : '';
    $keys{$_} = $_ . $suffix for (qw(precipitation sunshine solar));
    @keys{qw(windSpeed windGust windDirection)} = map { $_ . $suffix } qw(wind_speed wind_gust_speed wind_direction);
    for my $field (keys %keys) {
        my $number = FHEMCMS_WeatherNumber($raw->{$keys{$field}});
        $row{$field} = $number if (defined($number));
    }
    $row{icon} = $raw->{icon} if (defined($raw->{icon}) && !ref($raw->{icon}) && $weatherIcons{$raw->{icon}});
    my $condition = FHEMCMS_WeatherText($raw->{condition}, 30);
    $row{condition} = $condition if (length($condition));
    if (defined($row{icon}) && $row{icon} =~ /-(day|night)\z/) {
        $row{isDay} = $1 eq 'day' ? JSON::PP::true : JSON::PP::false;
    }
    return \%row;
}

sub FHEMCMS_WeatherAlert {
    my ($raw, $now) = @_;
    return undef if (ref($raw) ne 'HASH');
    my $expiry = FHEMCMS_WeatherEpoch($raw->{expires});
    return undef if (!defined($expiry) || $expiry <= $now);
    my %alert;
    for my $key (qw(id event headline severity onset expires description instruction)) {
        $alert{$key} = FHEMCMS_WeatherText($raw->{$key}, $key eq 'description' || $key eq 'instruction' ? 12000 : 400);
    }
    $alert{severity} = lc($alert{severity});
    $alert{color} = $weatherColors{$alert{severity}} // '#808080';
    return \%alert;
}

sub FHEMCMS_WeatherDays {
    my ($rows, $today) = @_;
    my %days;
    for my $row (@$rows) {
        my $date = substr($row->{timestamp}, 0, 10);
        next if ($date lt $today);
        my $day = $days{$date} //= { date => $date, periods => [] };
        for my $pair ([tempMin => 'temp'], [tempMax => 'temp'], [windSpeedMax => 'windSpeed'],
            [windGustMax => 'windGust'], [precipitationProbabilityMax => 'precipitationProbability']) {
            my ($key, $field) = @$pair;
            my $value = $row->{$field};
            next if (!defined($value));
            $day->{$key} = $value if (!defined($day->{$key}) || ($key eq 'tempMin' ? $value < $day->{$key} : $value > $day->{$key}));
        }
        for my $pair ([precipitationSum => 'precipitation'], [sunshineMinutes => 'sunshine'], [solarSum => 'solar']) {
            my ($key, $field) = @$pair;
            $day->{$key} += $row->{$field} if (defined($row->{$field}));
        }
        if ($row->{timestamp} =~ /T(00|06|12|18):00/) {
            push(@{$day->{periods}}, $row);
        }
        if (!defined($day->{icon}) || $row->{timestamp} =~ /T12:00/) {
            $day->{icon} = $row->{icon} if (defined($row->{icon}));
            $day->{wwCode} = $row->{wwCode} if (defined($row->{wwCode}));
        }
    }
    my @dates = sort keys %days;
    splice(@dates, 10) if (@dates > 10);
    return [map { $days{$_} } @dates];
}

sub FHEMCMS_WeatherHTTP {
    my ($url, $callback) = @_;
    HttpUtils_NonblockingGet({
        url => $url, timeout => 8, hideurl => 1, ignoreredirects => 1,
        sslargs => { SSL_verify_mode => 1, SSL_verifycn_scheme => 'http' },
        callback => sub {
            my ($param, $error, $data) = @_;
            my $json;
            if (!$error && ($param->{code} // 0) == 200 && defined($data) && length($data) <= 1500000) {
                $json = eval { $weatherJSON->decode($data) };
            }
            $callback->(ref($json) eq 'HASH' ? $json : undef);
        },
    });
}

sub FHEMCMS_WeatherBright {
    my ($lat, $lon, $old, $done) = @_;
    my $now = time();
    my $start = strftime('%Y-%m-%d', gmtime($now - 86400));
    my $end = strftime('%Y-%m-%d', gmtime($now + 10 * 86400));
    my $suffix = "lat=$lat&lon=$lon&tz=Europe%2FBerlin";
    my %result;
    my $pending = 3;
    my $collect = sub {
        my ($key, $json) = @_;
        $result{$key} = $json;
        return if (--$pending);
        my $observed = $result{current} // {};
        my $forecast = $result{forecast} // {};
        return $done->() if (ref($forecast->{weather}) ne 'ARRAY');
        my @timed;
        for my $raw (@{$forecast->{weather}}) {
            my $row = FHEMCMS_WeatherBrightRow($raw, 0);
            push(@timed, [FHEMCMS_WeatherEpoch($row->{timestamp}), $row]) if ($row);
        }
        @timed = sort { $a->[0] <=> $b->[0] } @timed;
        return $done->() if (!@timed);
        my @past = grep { $_->[0] <= $now } @timed;
        my $closest = @past ? $past[-1][1] : $timed[0][1];
        my $current = FHEMCMS_WeatherBrightRow($observed->{weather}, 1);
        my $hasObservation = defined($current);
        my $observedAt = $current ? $current->{timestamp} : undef;
        if (!$current && $old && $old->{current} && !$old->{current}{isForecast}) {
            $current = { %{$old->{current}}, stale => JSON::PP::true };
            $observedAt = $old->{updatedAt};
        }
        $current //= { %$closest, isForecast => JSON::PP::true };
        my $station = '';
        for my $source (ref($observed->{sources}) eq 'ARRAY' ? @{$observed->{sources}} : ()) {
            next if (ref($source) ne 'HASH' || !defined($observed->{weather}{source_id})
                || ($source->{id} // '') ne $observed->{weather}{source_id});
            $station = FHEMCMS_WeatherText($source->{station_name}, 120);
        }
        my $alertData = $result{alerts} // {};
        my $alertsOK = ref($alertData->{alerts}) eq 'ARRAY' && ref($alertData->{location}) eq 'HASH';
        my @alerts;
        if ($alertsOK) {
            for my $raw (@{$alertData->{alerts}}) {
                next if (ref($raw) ne 'HASH' || ($raw->{status} // '') ne 'actual');
                my $alert = FHEMCMS_WeatherAlert({
                    id => $raw->{alert_id}, severity => $raw->{severity}, onset => $raw->{onset}, expires => $raw->{expires},
                    map { $_ => $raw->{"${_}_de"} // $raw->{"${_}_en"} } qw(event headline description instruction),
                }, $now);
                push(@alerts, $alert) if ($alert);
            }
        } elsif ($old) {
            @alerts = grep { (FHEMCMS_WeatherEpoch($_->{expires}) // 0) > $now } @{$old->{alerts} // []};
        }
        $done->({source => 'brightsky', stationName => $station || ($old // {})->{stationName} || '',
            updatedAt => $observedAt // FHEMCMS_WeatherISO($now), current => $current,
            alerts => \@alerts, alertsUnavailable => $alertsOK ? JSON::PP::false : JSON::PP::true,
            hourly => [map { $_->[1] } grep { $_->[0] > $now && $_->[0] <= $now + 48 * 3600 } @timed],
            daily => FHEMCMS_WeatherDays([map { $_->[1] } @timed], substr($closest->{timestamp}, 0, 10)),
        }, !$alertsOK || !$hasObservation);
    };
    my $base = 'https://api.brightsky.dev/';
    FHEMCMS_WeatherHTTP("${base}weather?$suffix&date=$start&last_date=$end", sub { $collect->('forecast', @_); });
    FHEMCMS_WeatherHTTP("${base}current_weather?$suffix", sub { $collect->('current', @_); });
    FHEMCMS_WeatherHTTP("${base}alerts?lat=$lat&lon=$lon", sub { $collect->('alerts', @_); });
}

sub FHEMCMS_WeatherDevice {
    my ($device, $now) = @_;
    my $readings = $device->{READINGS} // {};
    my $updated = FHEMCMS_WeatherEpoch(($readings->{fc0_date} // {})->{TIME}) // $now;
    return FHEMCMS_WeatherDeviceReadings($device, $now, $updated, $readings) if (!defined($device->{'.TZ'}));
    local $ENV{TZ} = $device->{'.TZ'};
    my $value = FHEMCMS_WeatherDeviceReadings($device, $now, $updated, $readings);
    return $value;
}

sub FHEMCMS_WeatherDeviceReadings {
    my ($device, $now, $updated, $readings) = @_;
    my $val = sub { return ($readings->{$_[0]} // {})->{VAL}; };
    my @rows;
    my @days;
    my %keys = (temp => 'TTT', dewPoint => 'Td', windSpeed => 'FF', windGust => 'FX1',
        windDirection => 'DD', cloudCover => 'Neff', precipitation => 'RR1c',
        precipitationProbability => 'R101', pressure => 'PPPP', visibility => 'VV',
        sunshine => 'SunD1', solar => 'Rad1h', wwCode => 'ww');
    for my $key (sort keys %$readings) {
        next if ($key !~ /\A(fc([0-9])_(?:[0-9]|1[0-9]|2[0-3]))_time\z/);
        my ($prefix, $index) = ($1, $2);
        my $date = $val->("fc${index}_date") // '';
        my $stamp = $val->($key) // '';
        $stamp = "${date}T$stamp" if ($stamp =~ /\A\d{2}:\d{2}(?::\d{2})?\z/);
        $stamp =~ s/ /T/;
        my $epoch = FHEMCMS_WeatherEpoch($stamp);
        next if (!defined($epoch));
        my $offset = strftime('%z', localtime($epoch));
        $offset =~ s/\A([+-]\d\d)(\d\d)\z/$1:$2/;
        my %row = (timestamp => $stamp =~ /(?:Z|[+-]\d{2}:?\d{2})\z/ ? $stamp : $stamp . $offset);
        for my $field (keys %keys) {
            my $value = FHEMCMS_WeatherNumber($val->("${prefix}_$keys{$field}"));
            next if (!defined($value));
            $value /= 60 if ($field eq 'sunshine');
            $value /= 3600 if ($field eq 'solar');
            $value /= 100 if ($field eq 'pressure' && $value > 2000);
            $row{$field} = $value;
        }
        my $sun = FHEMCMS_WeatherNumber($val->("${prefix}_SunUp"));
        my ($hour) = $stamp =~ /T(\d{2}):/;
        my $day = defined($sun) ? $sun > 0 : $hour >= 6 && $hour < 18;
        my $icon = FHEMCMS_WeatherIcon($row{wwCode}, $day);
        $row{icon} = $icon if (defined($icon));
        push(@rows, [$epoch, \%row]);
    }
    @rows = sort { $a->[0] <=> $b->[0] } @rows;
    my @past = grep { $_->[0] <= $now } @rows;
    my @future = grep { $_->[0] > $now } @rows;
    my $today = strftime('%Y-%m-%d', localtime($now));
    @days = @{FHEMCMS_WeatherDays([map { $_->[1] } @rows], $today)};
    my %days = map { $_->{date} => $_ } @days;
    for my $index (0..9) {
        my $date = $val->("fc${index}_date");
        next if (!defined($date) || $date !~ /\A\d{4}-\d{2}-\d{2}\z/ || $date lt $today);
        my %keys = (tempMin => ['Tn', 'tempMin'], tempMax => ['Tx', 'tempMax']);
        for my $key (keys %keys) {
            for my $reading (@{$keys{$key}}) {
                my $value = FHEMCMS_WeatherNumber($val->("fc${index}_$reading"));
                next if (!defined($value));
                $days{$date} //= {date => $date, periods => []};
                $days{$date}{$key} = $value;
                last;
            }
        }
    }
    my @alerts;
    my $count = $val->('a_count');
    my $alertsOK = ($val->('a_state') // '') eq 'updated' && defined($count) && $count =~ /\A\d{1,3}\z/;
    for my $index (0..(defined($count) && $count =~ /\A\d{1,3}\z/ ? $count - 1 : -1)) {
        my $prefix = "a_${index}_";
        next if (lc($val->("${prefix}responseType") // '') eq 'allclear');
        my %dates;
        for my $field (qw(onset expires)) {
            my $epoch = FHEMCMS_WeatherEpoch($val->($prefix . $field));
            $dates{$field} = FHEMCMS_WeatherISO($epoch) if (defined($epoch));
        }
        my $alert = FHEMCMS_WeatherAlert({
            id => ($device->{NAME} // '') . "-$index",
            event => $val->("${prefix}eventDesc") // $val->("${prefix}event"),
            %dates, map { $_ => $val->($prefix . $_) } qw(headline severity description instruction),
        }, $now);
        push(@alerts, $alert) if ($alert);
    }
    return undef if (!@rows && !keys(%days) && !$alertsOK && !@alerts);
    my $closest = @past && $past[-1][0] >= $now - 21600 ? $past[-1][1]
        : @future && $future[0][0] <= $now + 21600 ? $future[0][1] : {};
    return {
        source => 'fhem_dwd', stationName => FHEMCMS_WeatherText($device->{NAME}, 120),
        updatedAt => FHEMCMS_WeatherISO($updated), current => { %$closest, isForecast => JSON::PP::true },
        alerts => \@alerts, alertsUnavailable => $alertsOK ? JSON::PP::false : JSON::PP::true,
        hourly => [map { $_->[1] } grep { $_->[0] <= $now + 48 * 3600 } @future],
        daily => [map { $days{$_} } sort keys %days],
    };
}

sub FHEMCMS_WeatherCached {
    my ($hash, $bucket, $key, $refresh) = @_;
    my $now = time();
    my $cache = $hash->{helper}{weatherCache}{$bucket} //= {};
    my $entry = $cache->{$key};
    if (!$entry) {
        if (keys(%$cache) >= $weatherLimit) {
            my ($victim) = sort { $cache->{$a}{touched} <=> $cache->{$b}{touched} }
                grep { !$cache->{$_}{pending} } keys(%$cache);
            return {error => 'Zu viele gleichzeitige Wetterabfragen'} if (!defined($victim));
            delete($cache->{$victim});
        }
        $entry = $cache->{$key} = {};
    }
    $entry->{touched} = $now;
    if (!$entry->{pending} && ($entry->{retryAt} // 0) <= $now && ($entry->{until} // 0) <= $now) {
        my $active = grep { $_->{pending} } values(%$cache);
        return {error => 'Zu viele gleichzeitige Wetterabfragen'} if ($active >= 8 && !$entry->{value});
        if ($active < 8) {
            $entry->{pending} = 1;
            $refresh->($entry->{value}, sub {
                my ($value, $partialFailure) = @_;
                delete($entry->{pending});
                my $failed = !defined($value) || $partialFailure;
                if ($failed) {
                    $entry->{retryAt} = time() + $weatherRetry;
                    Log3($hash->{NAME}, 4, 'FHEMCMS: Wetterquelle voruebergehend unvollstaendig oder nicht erreichbar');
                }
                if ($value) {
                    $entry->{value} = $value;
                    $entry->{until} = time() + ($partialFailure ? $weatherRetry : $weatherTTL);
                }
            });
        }
    }
    if ($entry->{value}) {
        my %response = %{$entry->{value}};
        $response{stale} = ($entry->{until} // 0) <= $now ? JSON::PP::true : JSON::PP::false;
        if ($bucket eq 'weather') {
            $response{alerts} = [grep { (FHEMCMS_WeatherEpoch($_->{expires}) // 0) > $now } @{$response{alerts}}];
            $response{alertsUnavailable} = JSON::PP::true if ($response{stale});
        }
        return \%response;
    }
    return $entry->{pending} ? {loading => JSON::PP::true} : {error => 'Wetterquelle derzeit nicht erreichbar'};
}

sub FHEMCMS_WeatherGet {
    my ($hash, $command, @args) = @_;
    if ($command eq 'weatherdevices') {
        return 'weatherdevices erwartet keine Parameter' if (@args);
        return $weatherJSON->encode({devices => [sort grep { FHEMCMS_ValidName($_)
            && ($main::defs{$_}{TYPE} // '') eq 'DWD_OpenData' } keys(%main::defs)]});
    }
    if ($command eq 'weathergeocode') {
        return 'Ungueltige Wettersuche' if (@args != 1 || $args[0] !~ /\A(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2}){2,240}\z/);
        my $bytes = $args[0];
        $bytes =~ s/%([0-9a-f]{2})/chr(hex($1))/ige;
        my $query = eval { decode('UTF-8', $bytes, FB_CROAK) };
        return 'Ungueltige Wettersuche' if (!defined($query) || length($query) < 2 || length($query) > 80 || $query =~ /[\x00-\x1f\x7f]/);
        my $encoded = encode('UTF-8', $query);
        $encoded =~ s/([^A-Za-z0-9_.~-])/sprintf('%%%02X', ord($1))/ge;
        my $postal = $query =~ /\A[0-9]{5}\z/ ? '&countryCode=DE' : '';
        return $weatherJSON->encode(FHEMCMS_WeatherCached($hash, 'search', $encoded, sub {
            my (undef, $done) = @_;
            FHEMCMS_WeatherHTTP("https://geocoding-api.open-meteo.com/v1/search?name=$encoded&count=8&language=de&format=json$postal", sub {
                my ($json) = @_;
                return $done->() if (!$json || $json->{error} || (exists($json->{results}) && ref($json->{results}) ne 'ARRAY'));
                my @results;
                for my $raw (@{$json->{results} // []}) {
                    next if (ref($raw) ne 'HASH');
                    my @coords = FHEMCMS_WeatherCoords(@{$raw}{qw(latitude longitude)});
                    my $name = FHEMCMS_WeatherText($raw->{name}, 120);
                    my $country = FHEMCMS_WeatherText($raw->{country_code}, 2);
                    next if (!@coords || !length($name) || $country !~ /\A[A-Z]{2}\z/);
                    push(@results, {name => $name, admin1 => FHEMCMS_WeatherText($raw->{admin1}, 120),
                        country => $country, lat => $coords[0], lon => $coords[1]});
                    last if (@results >= 8);
                }
                $done->({results => \@results});
            });
        }));
    }
    return 'weather erwartet <lat> <lon> oder device <name>' if (@args != 2);
    if ($args[0] eq 'device') {
        my $name = $args[1];
        return 'Ungueltiges DWD_OpenData-Device' if (!FHEMCMS_ValidName($name)
            || ($main::defs{$name}{TYPE} // '') ne 'DWD_OpenData');
        return $weatherJSON->encode(FHEMCMS_WeatherCached($hash, 'weather', "device:$name", sub {
            my (undef, $done) = @_;
            $done->(FHEMCMS_WeatherDevice($main::defs{$name}, time()));
        }));
    }
    my @coords = FHEMCMS_WeatherCoords(@args);
    return 'Ungueltige Wetter-Koordinaten' if (!@coords);
    my ($lat, $lon) = map { sprintf('%.5f', $_ == 0 ? 0 : $_) } @coords;
    return $weatherJSON->encode(FHEMCMS_WeatherCached($hash, 'weather', "$lat,$lon", sub {
        FHEMCMS_WeatherBright($lat, $lon, @_);
    }));
}

1;
