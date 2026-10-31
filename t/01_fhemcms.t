use strict;
use warnings;

use File::Path qw(make_path remove_tree);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use MIME::Base64 ();
use Test::More;

our (%attr, $FW_ME);

sub CommandAttr {
    my ($client, $definition) = @_;
    my ($name, $attribute, $value) = split(/\s+/, $definition, 3);
    $attr{$name}{$attribute} = $value;
    return undef;
}

require './FHEM/01_FHEMCMS.pm';

my $modHash = {};
FHEMCMS_Initialize($modHash);
is($modHash->{DefFn}, 'FHEMCMS_Define', 'registers the define callback');
is($modHash->{GetFn}, 'FHEMCMS_Get', 'registers the get callback');
is($modHash->{FW_summaryFn}, 'FHEMCMS_Summary', 'registers the FHEMWEB summary link');

my $modPath = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($modPath, 'www'));
$attr{global}{modpath} = $modPath;

my $name = 'CMS';
my $hash = {NAME => $name};
is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines a CMS test device');
is($attr{$name}{room}, 'FHEM CMS', 'assigns new devices to the FHEM CMS room');

my $pagePath = File::Spec->catfile(
    $modPath, 'www', 'fhem-cms', 'CMS', 'index.html');
ok(-f $pagePath, 'creates the device entry page directly in its directory');
ok(!-d File::Spec->catdir($modPath, 'www', 'fhem-cms', 'CMS', 'default'),
    'does not create a default surface subdirectory');

open(my $page, '<', $pagePath) or die "Cannot open generated page: $!";
my $html = do { local $/; <$page> };
close($page) or die "Cannot close generated page: $!";
like($html, qr/<cms-device-card device="CMS"/, 'bootstraps the requested device component');
like($html, qr{\.\./css/fhem-cms\.css}, 'loads shared CSS from the common asset tree');
like($html, qr{\.\./js/fhem-cms\.js}, 'loads shared JavaScript from the common asset tree');
like($html, qr{type="module"}, 'loads the frontend as an ES module');
ok(-f File::Spec->catfile(
    'www', 'fhem-cms', 'components', 'cms-device-card.js'),
    'provides the shared device-card component');

is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'redefining a device accepts its generated page');
is(FHEMCMS_Get($hash, $name, 'url'),
    '/fhem/fhem-cms/CMS/index.html',
    'returns the test page URL');
$FW_ME = '/fhem';
is(FHEMCMS_Summary('WEB', $name, 'FHEM CMS', {}),
    '<a href="/fhem/fhem-cms/CMS/index.html">CMS starten</a>',
    'renders a link to the device entry page in the FHEM room');
$FW_ME = '/custom-fhem';
like(FHEMCMS_Summary('WEB', $name, 'FHEM CMS', {}),
    qr{href="/custom-fhem/fhem-cms/CMS/index\.html"},
    'uses the current FHEMWEB path for the link');
$FW_ME = '/fhem';
my $dataDir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
ok(-d $dataDir, 'creates a data directory per device outside www');
ok(-f File::Spec->catfile($dataDir, 'config.json'), 'creates a default config');
my ($cfg, $cfgErr) = FHEMCMS_ReadConfig($name, $dataDir);
is($cfgErr, undef, 'default config is valid');
$cfg->{pages}[0]{widgets} = [{id => 'w1', type => 'fhem-value', device => 'Lamp', reading => 'state',
    grid => {col => 1, row => 1, w => 2, h => 1}}];
is(FHEMCMS_WriteConfig($name, $dataDir, $cfg), undef, 'writes a valid config');
my @backups = FHEMCMS_ListBackups($dataDir);
is(scalar(@backups), 1, 'keeps a timestamped backup of the previous config');
like($backups[0], qr/\Aconfig\.json\.\d{8}-\d{6}\.bak\z/, 'backup name carries a timestamp');
$cfg->{pages}[0]{bogus} = 1;
like(FHEMCMS_WriteConfig($name, $dataDir, $cfg), qr/Unbekanntes Feld 'bogus'/, 'rejects unknown fields');
is(FHEMCMS_RestoreBackup($name, $dataDir, $backups[0]), undef, 'restores a backup');
my ($restored) = FHEMCMS_ReadConfig($name, $dataDir);
is(scalar(@{$restored->{pages}[0]{widgets}}), 0, 'restored config is the earlier version');
like(FHEMCMS_RestoreBackup($name, $dataDir, '../x'), qr/Ungueltiger Backup-Name/, 'rejects path-like backup names');
my ($big, $bigErr) = FHEMCMS_ParseConfig('x' x 1048577);
like($bigErr, qr/zu gross/, 'rejects oversized config');
my $thermostat = {id => 't1', type => 'thermostat', device => 'th_Buero', title => 'Buero',
    readings => {actual => 'temperature', target => 'desiredTemperature', valve => 'valveposition'},
    grid => {col => 3, row => 1, w => 4, h => 2}};
push(@{$restored->{pages}[0]{widgets}}, $thermostat);
is(FHEMCMS_WriteConfig($name, $dataDir, $restored), undef, 'accepts a thermostat widget');
my $bad = {%{$thermostat}, id => 't2', readings => {actual => 'temperature'}};
push(@{$restored->{pages}[0]{widgets}}, $bad);
like(FHEMCMS_WriteConfig($name, $dataDir, $restored), qr/Pflichtfeld 'target'/,
    'requires the target reading for thermostats');
pop(@{$restored->{pages}[0]{widgets}});
push(@{$restored->{pages}[0]{widgets}}, {%{$thermostat}});
like(FHEMCMS_WriteConfig($name, $dataDir, $restored), qr/Doppelte Widget-ID/, 'rejects duplicate widget ids');
pop(@{$restored->{pages}[0]{widgets}});
my $migrated = FHEMCMS_MigrateConfig({schemaVersion => 1, pages => [{id => 'p', title => 'P',
    widgets => [{type => 'fhem-value', device => 'A', reading => 'r',
        grid => {col => 1, row => 1, w => 1, h => 1}}]}]});
is(FHEMCMS_ValidateConfig($migrated), undef, 'migrates a version 1 config to version 2');
is($migrated->{pages}[0]{widgets}[0]{id}, 'w1', 'assigns ids during migration');

my $json = FHEMCMS_Get($hash, $name, 'config');
my $decoded = JSON::PP::decode_json($json);
is(scalar(@{$decoded->{pages}[0]{widgets}}), 1, 'get config returns the stored config as JSON');
like(FHEMCMS_Get($hash, $name, 'backups'), qr/config\.json\.\d{8}-\d{6}/, 'get backups lists backup names');

my $payload = MIME::Base64::encode_base64(JSON::PP->new->utf8->encode(FHEMCMS_DefaultConfig()), '');
is(FHEMCMS_Set($hash, $name, 'config', $payload), undef, 'set config stores a Base64 payload');
my $stored = JSON::PP::decode_json(FHEMCMS_Get($hash, $name, 'config'));
is(scalar(@{$stored->{pages}[0]{widgets}}), 0, 'set config replaced the config');
like(FHEMCMS_Set($hash, $name, 'config', 'not base64!'), qr/Base64/, 'set config rejects non-Base64 input');
like(FHEMCMS_Set($hash, $name, 'config', MIME::Base64::encode_base64('{"schemaVersion":2}', '')),
    qr/Pflichtfeld 'pages'/, 'set config validates the payload');
my ($latest) = FHEMCMS_ListBackups($dataDir);
is(FHEMCMS_Set($hash, $name, 'restore', $latest), undef, 'set restore restores a backup');
like(FHEMCMS_Set($hash, $name, 'restore', '../x'), qr/Ungueltiger Backup-Name/, 'set restore rejects bad names');
like(FHEMCMS_Set($hash, $name, 'bogus'), qr/Unknown argument/, 'set rejects unknown commands');

unlink(File::Spec->catfile($dataDir, 'config.json'));
remove_tree($dataDir);
is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'redefine recreates missing data for existing devices');
ok(-f File::Spec->catfile($dataDir, 'config.json'), 'recreates the missing default config');
is(FHEMCMS_Undef($hash), undef, 'allows deleting the device definition');
ok(-d $dataDir, 'keeps the device data directory when the definition is deleted');
ok(-f $pagePath, 'keeps the device files when the definition is deleted');

my $lowercaseName = 'cmsLowercase';
my $lowercaseHash = {NAME => $lowercaseName};
is(FHEMCMS_Define($lowercaseHash, "$lowercaseName fhemcms"), undef,
    'accepts a lowercase module type');
ok(-f File::Spec->catfile(
    $modPath, 'www', 'fhem-cms', $lowercaseName, 'index.html'),
    'creates the start page for a lowercase module type');

my $customRoomName = 'cmsCustomRoom';
$attr{$customRoomName}{room} = 'Arbeitszimmer';
my $customRoomHash = {NAME => $customRoomName};
is(FHEMCMS_Define($customRoomHash, "$customRoomName FHEMCMS"), undef,
    'defines a device with a preconfigured room');
is($attr{$customRoomName}{room}, 'Arbeitszimmer',
    'preserves a room already assigned by the user');

my $invalid = {NAME => '../escape'};
like(FHEMCMS_Define($invalid, '../escape FHEMCMS'), qr/Device-Name/,
    'rejects path syntax in device names');

my $collisionName = 'cmsCollision';
my $collisionPath = File::Spec->catfile(
    $modPath, 'www', 'fhem-cms', $collisionName, 'index.html');
make_path(File::Spec->catdir($modPath, 'www', 'fhem-cms', $collisionName));
open(my $custom, '>', $collisionPath) or die "Cannot create collision fixture: $!";
print {$custom} 'user-owned file';
close($custom) or die "Cannot close collision fixture: $!";
my $collision = {NAME => $collisionName};
like(FHEMCMS_Define($collision, "$collisionName FHEMCMS"), qr/existiert bereits/,
    'does not overwrite a file without the module ownership marker');
open(my $preserved, '<', $collisionPath) or die "Cannot read collision fixture: $!";
is(do { local $/; <$preserved> }, 'user-owned file', 'preserves the existing file');
close($preserved) or die "Cannot close collision fixture: $!";

done_testing();
