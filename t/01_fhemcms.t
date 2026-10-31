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

my @logged;
sub Log3 { push(@logged, [@_]); return; }

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
my $textWidget = {id => 'x1', type => 'text', title => 'Hinweis', markdown => "# Titel\n\nText mit **fett**",
    grid => {col => 1, row => 3, w => 6, h => 2}};
push(@{$restored->{pages}[0]{widgets}}, $textWidget);
is(FHEMCMS_WriteConfig($name, $dataDir, $restored), undef, 'accepts a text widget');
pop(@{$restored->{pages}[0]{widgets}});
for my $case (
    ['control characters', {%{$textWidget}, id => 'x2', markdown => "a\x01b"}, qr/Markdown/],
    ['oversized text', {%{$textWidget}, id => 'x3', markdown => 'a' x 20001}, qr/Markdown/],
    ['text without markdown', {id => 'x4', type => 'text', grid => $textWidget->{grid}}, qr/Pflichtfeld 'markdown'/],
    ['text with device', {%{$textWidget}, id => 'x5', device => 'Lamp'}, qr/Unbekanntes Feld 'device'/],
    ['non-string text', {%{$textWidget}, id => 'x6', markdown => ['a']}, qr/Markdown/],
    ['long title', {%{$textWidget}, id => 'x7', title => 'a' x 65}, qr/Widget-Titel/],
) {
    my ($label, $widget, $expected) = @{$case};
    push(@{$restored->{pages}[0]{widgets}}, $widget);
    like(FHEMCMS_ValidateConfig($restored), $expected, "rejects a text widget with $label");
    pop(@{$restored->{pages}[0]{widgets}});
}
push(@{$restored->{pages}[0]{widgets}}, {%{$textWidget}, markdown => "Zeile\r\n\tTab"});
is(FHEMCMS_ValidateConfig($restored), undef, 'allows line breaks and tabs in text');
pop(@{$restored->{pages}[0]{widgets}});
my $migrated = FHEMCMS_MigrateConfig({schemaVersion => 1, pages => [{id => 'p', title => 'P',
    widgets => [{type => 'fhem-value', device => 'A', reading => 'r',
        grid => {col => 1, row => 1, w => 1, h => 1}}]}]});
is(FHEMCMS_ValidateConfig($migrated), undef, 'migrates a version 1 config to version 2');
is($migrated->{pages}[0]{widgets}[0]{id}, 'w1', 'assigns ids during migration');

my $json = FHEMCMS_Get($hash, $name, 'config');
my $decoded = JSON::PP::decode_json($json);
is(scalar(@{$decoded->{pages}[0]{widgets}}), 2, 'get config returns the stored config as JSON');
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

# Cache-Busting der Startseite
my $assetRoot = File::Spec->catdir($modPath, 'www', 'fhem-cms');
foreach my $dir ('css', 'js', 'components') {
    make_path(File::Spec->catdir($assetRoot, $dir));
}
sub write_file {
    my ($path, $text) = @_;
    open(my $out, '>', $path) or die "Cannot write $path: $!";
    print {$out} $text;
    close($out) or die "Cannot close $path: $!";
}
sub read_file {
    my ($path) = @_;
    open(my $in, '<', $path) or die "Cannot read $path: $!";
    local $/;
    return <$in>;
}
write_file(File::Spec->catfile($assetRoot, 'css', 'fhem-cms.css'), 'a{}');
write_file(File::Spec->catfile($assetRoot, 'js', 'fhem-cms.js'), 'one');
write_file(File::Spec->catfile($assetRoot, 'js', 'fhem-client.js'), 'client');
write_file(File::Spec->catfile($assetRoot, 'components', 'cms-widget.js'), 'widget');
is(FHEMCMS_Define({NAME => 'CMS'}, 'CMS FHEMCMS'), undef, 'redefines an existing device');
my $first = read_file($pagePath);
like($first, qr{fhem-cms\.css\?v=[0-9a-f]{10}"}, 'versions the stylesheet URL');
like($first, qr{fhem-cms\.js\?v=[0-9a-f]{10}"}, 'versions the entry script URL');
like($first, qr{"\.\./components/cms-widget\.js"\s*:\s*"\.\./components/cms-widget\.js\?v=[0-9a-f]{10}"},
    'maps component modules to versioned URLs');
like($first, qr{"\.\./js/fhem-client\.js"\s*:\s*"\.\./js/fhem-client\.js\?v=[0-9a-f]{10}"},
    'maps helper modules to versioned URLs');
unlike($first, qr{"\.\./js/fhem-cms\.js":}, 'does not map the entry script itself');
my ($tokenOne) = $first =~ m{fhem-cms\.css\?v=([0-9a-f]+)};
is(FHEMCMS_Define({NAME => 'CMS'}, 'CMS FHEMCMS'), undef, 'redefines without asset changes');
is(read_file($pagePath), $first, 'keeps the page unchanged without asset changes');
write_file(File::Spec->catfile($assetRoot, 'components', 'cms-widget.js'), 'widget v2');
is(FHEMCMS_Define({NAME => 'CMS'}, 'CMS FHEMCMS'), undef, 'redefines after an asset change');
my ($tokenTwo) = read_file($pagePath) =~ m{fhem-cms\.css\?v=([0-9a-f]+)};
isnt($tokenTwo, $tokenOne, 'regenerates the page with a new token after an asset change');
ok(!-e "$pagePath.tmp", 'leaves no temporary page file behind');

# rebuild und automatische Auffrischung
my $assetFile = File::Spec->catfile($assetRoot, 'components', 'cms-widget.js');
write_file($assetFile, 'widget v3');
is(FHEMCMS_Set($hash, $name, 'rebuild'), undef, 'set rebuild regenerates the page');
my ($tokenThree) = read_file($pagePath) =~ m{fhem-cms\.css\?v=([0-9a-f]+)};
isnt($tokenThree, $tokenTwo, 'rebuild picks up changed assets');
like(FHEMCMS_Set($hash, $name, 'rebuild', 'x'), qr/keine Parameter/, 'rebuild rejects parameters');
write_file($assetFile, 'widget v4');
%main::FHEMCMS_LAST_REFRESH = ();
FHEMCMS_Summary('WEB', $name);
my ($tokenFour) = read_file($pagePath) =~ m{fhem-cms\.css\?v=([0-9a-f]+)};
isnt($tokenFour, $tokenThree, 'summary refreshes the page after asset changes');
write_file($assetFile, 'widget v5');
FHEMCMS_Summary('WEB', $name);
my ($tokenStill) = read_file($pagePath) =~ m{fhem-cms\.css\?v=([0-9a-f]+)};
is($tokenStill, $tokenFour, 'summary throttles repeated refreshes');

# purge
my $pName = 'cmsPurge';
my $pHash = {NAME => $pName};
is(FHEMCMS_Define($pHash, "$pName FHEMCMS"), undef, 'defines a device for purge tests');
my $pData = File::Spec->catdir($modPath, 'fhem-cms-data', $pName);
my $pPage = File::Spec->catdir($modPath, 'www', 'fhem-cms', $pName);
ok(-d $pData && -d $pPage, 'purge test device has data and page');
like(FHEMCMS_Set($pHash, $pName, 'purge'), qr/Bestaetigung/, 'purge needs a confirmation argument');
like(FHEMCMS_Set($pHash, $pName, 'purge', 'other'), qr/Device-Name/, 'purge rejects a wrong confirmation');
like(FHEMCMS_Set($pHash, $pName, 'purge', $pName, 'x'), qr/Bestaetigung/, 'purge rejects extra arguments');
ok(-d $pData && -d $pPage, 'failed purge keeps everything');

write_file(File::Spec->catfile($pPage, 'extra.txt'), 'mine');
like(FHEMCMS_Set($pHash, $pName, 'purge', $pName), qr/fremde Dateien \(extra\.txt\)/, 'purge refuses foreign files in the page folder');
ok(-d $pData && -d $pPage, 'refused purge keeps everything');
unlink(File::Spec->catfile($pPage, 'extra.txt'));

my $pIndex = File::Spec->catfile($pPage, 'index.html');
my $pOriginal = read_file($pIndex);
write_file($pIndex, "<html>hand made</html>\n");
like(FHEMCMS_Set($pHash, $pName, 'purge', $pName), qr/nicht von diesem Modul/, 'purge refuses a page without the module marker');
write_file($pIndex, $pOriginal);

my $moved = $pData . '.real';
rename($pData, $moved);
symlink($moved, $pData);
like(FHEMCMS_Set($pHash, $pName, 'purge', $pName), qr/Symlink/, 'purge refuses a symlinked data folder');
ok(-d $moved && -d $pPage, 'symlink refusal keeps targets');
unlink($pData);
rename($moved, $pData);

is(FHEMCMS_Set($pHash, $pName, 'purge', $pName), undef, 'purge removes data and page');
ok(!-e $pData && !-e $pPage, 'data and page folders are gone');
ok(-d File::Spec->catdir($modPath, 'www', 'fhem-cms'), 'purge keeps the shared asset folder');
like(FHEMCMS_Get($pHash, $pName, 'config'), qr/geloescht/, 'get is blocked after purge');
like(FHEMCMS_Set($pHash, $pName, 'rebuild'), qr/geloescht/, 'set is blocked after purge');
like(FHEMCMS_Summary('WEB', $pName), qr/Daten geloescht/, 'summary shows the purged state without a link');
ok(!-e $pData && !-e $pPage, 'blocked calls do not recreate the folders');
is(FHEMCMS_Define($pHash, "$pName FHEMCMS"), undef, 'redefine after purge works');
ok(-f File::Spec->catfile($pData, 'config.json') && -f $pIndex, 'redefine recreates data and page');

done_testing();
