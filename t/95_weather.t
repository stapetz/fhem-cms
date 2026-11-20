use strict;
use warnings;
use utf8;
use JSON::PP ();
use Test::More;
use POSIX qw(strftime);

require './FHEM/01_FHEMCMS.pm';

our %defs;
my @requests;
my @logs;
sub HttpUtils_NonblockingGet { push @requests, $_[0]; }
sub Log3 { push @logs, $_[2]; }

my $json = JSON::PP->new->utf8;
my $cms = {NAME => 'CMS'};
my $get = sub { $json->decode(FHEMCMS_Get($cms, 'CMS', @_)); };
my $respond = sub {
    my ($request, $data, $code) = @_;
    $request->{code} = $code // 200;
    $request->{callback}->($request, '', $json->encode($data));
};

my $location = {name => 'Häuser', country => 'DE', lat => 53.14, lon => 8.21};
my $weather = {id => 'w1', type => 'weather', config => {dataSource => 'brightsky', location => $location,
    forecastDays => 3, showAlertsBanner => JSON::PP::true}, grid => {col => 1, row => 2, w => 6, h => 4}};
my $config = {schemaVersion => 6, settings => {layoutMode => 'grid', gridColumns => 48},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 48, h => 1}},
    pages => [{id => 'start', title => 'Start', widgets => [$weather]}]};
is(FHEMCMS_ValidateConfig($config, 6), undef, 'weather config accepted in grid');
$config->{pages}[0]{layoutMode} = 'freeform';
$config->{pages}[0]{canvas} = {width => 1280, height => 800, scaling => 'fit', snapGrid => 5, mobileBehavior => 'stack'};
$weather->{rect} = {x => 0, y => 0, w => 320, h => 240};
is(FHEMCMS_ValidateConfig($config, 6), undef, 'weather config accepted in freeform');
$location->{lat} = '53.14';
like(FHEMCMS_ValidateConfig($config, 6), qr/Koordinaten/, 'reject string coordinate in saved config');
$location->{lat} = 91;
like(FHEMCMS_ValidateConfig($config, 6), qr/Koordinaten/, 'reject out of range coordinate');
$weather->{config} = {dataSource => 'fhem_dwd', device => 'Weather', enableDetailPopup => JSON::PP::false};
is(FHEMCMS_ValidateConfig($config, 6), undef, 'local device config accepted');
$weather->{config}{forecastDays} = 9;
like(FHEMCMS_ValidateConfig($config, 6), qr/Vorhersagetage/, 'reject too many forecast days');

ok($get->('weathergeocode', 'M%C3%BCnchen')->{loading}, 'geocode runs without blocking');
is(scalar @requests, 1, 'one search request queued');
like($requests[0]{url}, qr{\Ahttps://geocoding-api\.open-meteo\.com/v1/search\?name=M%C3%BCnchen&}, 'proper UTF-8 URL encoding');
ok($requests[0]{ignoreredirects} && $requests[0]{sslargs}{SSL_verify_mode}, 'HTTPS verification and no redirected requests');
$respond->(shift @requests, {results => [{name => 'München', latitude => 48.14, longitude => 11.58, country_code => 'DE'}]});
is($get->('weathergeocode', 'M%C3%BCnchen')->{results}[0]{name}, 'München', 'geocode normalized');
like(FHEMCMS_Get($cms, 'CMS', 'weathergeocode', '%0Afoo'), qr/Ungueltig/, 'reject encoded control characters');
ok($get->('weathergeocode', '80331')->{loading}, 'postal search is asynchronous');
like($requests[0]{url}, qr/&countryCode=DE\z/, 'five-digit postal search avoids foreign postal matches');
$respond->(shift @requests, {});
is_deeply($get->('weathergeocode', '80331')->{results}, [], 'missing postcode records return an empty result');
like(FHEMCMS_Get($cms, 'CMS', 'weather', '53&lon=42', 8), qr/Koordinaten/, 'reject malformed request coordinate');

my $now = time();
my $hour = $now - $now % 3600;
my $past = FHEMCMS_WeatherISO($hour);
my $future = FHEMCMS_WeatherISO($hour + 3600);
my $expiry = FHEMCMS_WeatherISO($hour + 7200);
ok($get->('weather', 53.14, 8.21)->{loading}, 'weather fetch asks client to poll');
ok($get->('weather', '53.1400', '8.210')->{loading}, 'pending response shared for canonical coords');
is(scalar @requests, 3, 'concurrent widgets share all three upstream requests');
$respond->(shift @requests, {weather => [
    {timestamp => $past, temperature => 0, precipitation => 0, icon => 'cloudy', sunshine => 4},
    {timestamp => $future, temperature => 6, precipitation => 2, icon => 'rain', sunshine => 5, precipitation_probability => 90},
]});
$respond->(shift @requests, {weather => {timestamp => $past, temperature => 2.5, solar_60 => 0.1, wind_speed_60 => 12, source_id => 8},
    sources => [{id => 8, station_name => 'Oldenburg'}]});
$respond->(shift @requests, {location => {name => 'Oldenburg'}, alerts => [
    {alert_id => 'alert', status => 'actual', severity => 'moderate', expires => $expiry, onset => $past, headline_de => '<b>Warnung</b>'},
    {alert_id => 'old', status => 'actual', severity => 'minor', expires => $past},
]});
my $online = $get->('weather', 53.14, 8.21);
is($online->{current}{windSpeed}, 12, 'normalizes current forecast-independent measurement');
is($online->{stationName}, 'Oldenburg', 'source station given');
is($online->{hourly}[0]{temp}, 6, 'forecast begins at next hour');
is($online->{alerts}[0]{headline}, '<b>Warnung</b>', 'official warning text preserved verbatim as data');
is(scalar @{$online->{alerts}}, 1, 'expired warnings are not presented as active');
is(scalar @requests, 0, 'fresh cache avoids any upstream calls');

my ($entry) = values %{$cms->{helper}{weatherCache}{weather}};
$entry->{until} = $now - 1;
my $cached = $get->('weather', 53.14, 8.21);
ok($cached->{stale} && $cached->{alertsUnavailable}, 'expired payload stays visible and marks warnings unconfirmed');
is(scalar @requests, 3, 'expired entry refreshes asynchronously');
$respond->(shift @requests, {}, 503) while (@requests);
$cached = $get->('weather', 53.14, 8.21);
ok($cached->{stale} && @{$cached->{alerts}} && $cached->{current}{temp} == 2.5,
    'outage retains last valid payload and warning');
is(scalar @requests, 0, 'failed refresh backs off');
ok(@logs, 'upstream error is logged without the query');

my $localDate = substr($past, 0, 10);
my $localClock = substr($past, 11, 5);
my %values = (fc0_date => $localDate, fc0_0_time => $localClock, fc0_0_TTT => 6.4, fc0_0_ww => 68,
    fc_description => 'OLDENBURG', fc_station => '10215',
    fc0_0_SunD1 => 600, fc0_0_PPPP => 100200, fc0_Tn => 2, fc0_Tx => 7,
    a_count => 1, a_state => 'updated', a_0_eventDesc => 'Böen', a_0_severity => 'Severe',
    a_0_onset => $past, a_0_expires => $expiry);
$defs{Weather} = {NAME => 'Weather', TYPE => 'DWD_OpenData', '.TZ' => 'UTC',
    READINGS => {map { $_ => {VAL => $values{$_}, TIME => $past} } keys(%values)}};
$defs{Other} = {NAME => 'Other', TYPE => 'dummy'};
is_deeply($get->('weatherdevices')->{devices}, ['Weather'], 'only DWD_OpenData devices returned');
like(FHEMCMS_Get($cms, 'CMS', 'weather', 'device', 'Other'), qr/DWD_OpenData-Device/, 'reject other device types');
my $local = $get->('weather', 'device', 'Weather');
is($local->{forecastStationName}, 'OLDENBURG', 'uses the forecast station description, not the device name');
is($local->{forecastStationId}, '10215', 'includes forecast station code for fallback display');
is($local->{current}{temp}, 6.4, 'reads actual DWD sample naming');
is($local->{current}{icon}, 'sleet', 'WMO overlapping code mapped specifically');
is($local->{current}{sunshine}, 10, 'DWD duration normalized from seconds to minutes');
ok($local->{current}{isForecast}, 'device forecast not presented as measured conditions');
is($local->{daily}[0]{tempMin}, 2, 'uses DWD daily minimum');
is($local->{alerts}[0]{event}, 'Böen', 'device warning localized');
is($local->{alerts}[0]{severity}, 'severe', 'device severity normalized');
is(scalar @requests, 0, 'local source makes no network requests');
done_testing();
