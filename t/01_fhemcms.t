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
like($html, qr/<main class="cms-shell">\s*<p class="cms-status"/, 'bootstraps a slim shell with a status line');
unlike($html, qr/<h1|cms-kicker|cms-device-card/, 'has no header area');
like($html, qr{\.\./css/fhem-cms\.css}, 'loads shared CSS from the common asset tree');
like($html, qr{\.\./js/fhem-cms\.js}, 'loads shared JavaScript from the common asset tree');
like($html, qr{type="module"}, 'loads the frontend as an ES module');

is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'redefining a device accepts its generated page');
is(FHEMCMS_Get($hash, $name, 'url'),
    '/fhem/fhem-cms/CMS/index.html',
    'returns the test page URL');
$FW_ME = '/fhem';
is(FHEMCMS_Summary('WEB', $name, 'FHEM CMS', {}),
    '<a href="/fhem/fhem-cms/CMS/index.html?mode=edit" target="_blank" rel="noopener">CMS starten</a> <a href="/fhem/fhem-cms/CMS/index.html" target="_blank" rel="noopener">Zeige Homepage</a>',
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
$restored->{navigation} = {orientation => 'vertical', grid => {col => 1, row => 1, w => 3, h => 4}};
is(FHEMCMS_ValidateConfig($restored), undef, 'accepts a navigation widget');
for my $case (
    ['bad orientation', {orientation => 'diagonal', grid => {col => 1, row => 1, w => 3, h => 4}}, qr/Ausrichtung/],
    ['bad grid', {orientation => 'horizontal', grid => {col => 10, row => 1, w => 5, h => 1}}, qr/Rasterwerte/],
    ['unknown field', {orientation => 'horizontal', grid => {col => 1, row => 1, w => 3, h => 1}, x => 1}, qr/Unbekanntes Feld 'x'/],
    ['missing grid', {orientation => 'horizontal'}, qr/Pflichtfeld 'grid'/],
) {
    my ($label, $navigation, $expected) = @{$case};
    local $restored->{navigation} = $navigation;
    like(FHEMCMS_ValidateConfig($restored), $expected, "rejects a navigation with $label");
}
$restored->{navigation}{items} = [{page => $restored->{pages}[0]{id}, label => 'Daheim', width => 120, height => 40}, ];
is(FHEMCMS_ValidateConfig($restored), undef, 'accepts navigation items with label and size');
for my $case (
    ['unknown page', [{page => 'nope'}], qr/unbekannte Seite/],
    ['duplicate item', [{page => $restored->{pages}[0]{id}}, {page => $restored->{pages}[0]{id}}], qr/Doppelter/],
    ['empty label', [{page => $restored->{pages}[0]{id}, label => ''}], qr/Beschriftung/],
    ['control label', [{page => $restored->{pages}[0]{id}, label => "a\x01"}], qr/Beschriftung/],
    ['tiny width', [{page => $restored->{pages}[0]{id}, width => 10}], qr/Breite/],
    ['huge height', [{page => $restored->{pages}[0]{id}, height => 900}], qr/Hoehe/],
    ['unknown field', [{page => $restored->{pages}[0]{id}, color => 'red'}], qr/Unbekanntes Feld 'color'/],
) {
    my ($label, $items, $expected) = @{$case};
    local $restored->{navigation}{items} = $items;
    like(FHEMCMS_ValidateConfig($restored), $expected, "rejects navigation items with $label");
}
delete($restored->{navigation});
is(FHEMCMS_ValidateConfig($restored), undef, 'navigation stays optional');
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

# restore dropdown
my $usage = FHEMCMS_Set($pHash, $pName, '?');
like($usage, qr/choose one of config draft publish:noArg discard:noArg restore(?::|\s)/, 'usage names restore');
write_file(File::Spec->catfile($pData, 'config.json.20200101-000000.bak'), read_file(File::Spec->catfile($pData, 'config.json')));
like(FHEMCMS_Set($pHash, $pName, '?'), qr/restore:config\.json\.20200101-000000\.bak/, 'usage lists backups as dropdown');
{
    local $main::FHEMCMS_USAGE_BACKUPS = 1;
    for my $i (1 .. 3) {
        write_file(File::Spec->catfile($pData, "config.json.2021010$i-000000.bak"), read_file(File::Spec->catfile($pData, 'config.json')));
    }
    my ($list) = FHEMCMS_Set($pHash, $pName, '?') =~ /restore:(\S+)/;
    is($list, 'config.json.20210103-000000.bak', 'usage limits the list to the newest backups');
}

# draft and publish
my $liveFile = File::Spec->catfile($pData, 'config.json');
my $draftFile = File::Spec->catfile($pData, 'draft.json');
my $liveBefore = read_file($liveFile);
my $backupsBefore = scalar(my @b0 = FHEMCMS_ListBackups($pData));
is(FHEMCMS_Get($pHash, $pName, 'status'), '{"draft":false}', 'status reports no draft');
is(FHEMCMS_Get($pHash, $pName, 'draft'), FHEMCMS_Get($pHash, $pName, 'config'), 'draft falls back to the live config');
like(FHEMCMS_Set($pHash, $pName, 'publish'), qr/keinen Entwurf/, 'publish needs a draft');
my $draftCfg = {schemaVersion => 2, pages => [{id => 'start', title => 'Entwurf', widgets => []}]};
my $draftB64 = MIME::Base64::encode_base64(JSON::PP->new->utf8->encode($draftCfg), '');
is(FHEMCMS_Set($pHash, $pName, 'draft', $draftB64), undef, 'saves a draft');
ok(-f $draftFile, 'draft file exists');
is(read_file($liveFile), $liveBefore, 'saving a draft does not touch the live config');
is(scalar(my @b1 = FHEMCMS_ListBackups($pData)), $backupsBefore, 'saving a draft creates no backup');
is(FHEMCMS_Get($pHash, $pName, 'status'), '{"draft":true}', 'status reports the draft');
like(FHEMCMS_Get($pHash, $pName, 'draft'), qr/"title":"Entwurf"/, 'get draft returns the draft');
unlike(FHEMCMS_Get($pHash, $pName, 'config'), qr/Entwurf/, 'get config still returns the live config');
like(FHEMCMS_Set($pHash, $pName, 'draft', MIME::Base64::encode_base64('{"schemaVersion":2,"pages":[]}', '')),
    qr/\S/, 'rejects an invalid draft');
is(FHEMCMS_Set($pHash, $pName, 'discard'), undef, 'discards the draft');
ok(!-e $draftFile, 'draft file is gone after discard');
is(FHEMCMS_Set($pHash, $pName, 'discard'), undef, 'discard without a draft is fine');
FHEMCMS_Set($pHash, $pName, 'draft', $draftB64);
my $restoreFrom = (FHEMCMS_ListBackups($pData))[0];
is(FHEMCMS_Set($pHash, $pName, 'restore', $restoreFrom), undef, 'restore works while a draft exists');
ok(-f $draftFile, 'restore leaves the draft untouched');
is(FHEMCMS_Set($pHash, $pName, 'publish'), undef, 'publishes the draft');
like(FHEMCMS_Get($pHash, $pName, 'config'), qr/"title":"Entwurf"/, 'live config now has the draft content');
ok(!-e $draftFile, 'draft is removed after publish');
my @afterPublish = FHEMCMS_ListBackups($pData);
ok(scalar(@afterPublish) > $backupsBefore, 'publish creates a new backup version');
write_file($draftFile, '{kaputt');
like(FHEMCMS_Set($pHash, $pName, 'publish'), qr/Entwurf ist ungueltig/, 'publish refuses a broken draft');
like(FHEMCMS_Get($pHash, $pName, 'config'), qr/"title":"Entwurf"/, 'a refused publish keeps the live config');
unlink($draftFile);
like(FHEMCMS_Set($pHash, $pName, 'publish', 'x'), qr/keine Parameter/, 'publish takes no parameters');

# html text widgets
my $md5 = 'a' x 32;
my @validHtml = (
    '<p>Hallo <strong>Welt</strong> &amp; <em>mehr</em></p>',
    '<h1 class="cms-align-center">Titel</h1><ul><li>eins</li><li>zwei</li></ul>',
    '<p><a href="https://example.org/a?x=1&amp;y=2">Link</a> <a href="#/start">Seite</a></p>',
    '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td class="cms-align-right">1</td></tr></tbody></table>',
    "<p><img src=\"media/$md5.png\" alt=\"Bild\" class=\"cms-img-left cms-w-50\"><br></p>",
    "<p><img src=\"media/$md5.png\" class=\"cms-w-35\"><br></p>",
    '<p><span style="color:#ff0000">rot</span> <span style="background-color:#ffe066">gelb</span> <span style="color:#00ff00;background-color:#000000">beides</span></p>',
    "<p>Zeile 1\n\tZeile 2 \"zitiert\" it's</p>",
    '',
);
is(FHEMCMS_ValidateHtml($_), undef, 'accepts html: ' . substr($_, 0, 30)) for @validHtml;

my @badHtml = (
    ['<script>alert(1)</script>', 'script tag'],
    ['<p onclick="x()">a</p>', 'event attribute'],
    ['<p style="color:red">a</p>', 'style attribute'],
    ['<span style="color:red">a</span>', 'named color'],
    ['<span style="color:#ff0000;position:fixed">a</span>', 'extra style property'],
    ['<span style="color:#ff0000;background:url(x)">a</span>', 'style with url'],
    ['<span style="color:#f00">a</span>', 'short hex color'],
    ['<span class="cms-align-left">a</span>', 'class on span'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript link'],
    ['<a href="//evil.example/">x</a>', 'protocol relative link'],
    ['<a>x</a>', 'link without href'],
    ['<img src="https://evil.example/x.png">', 'external image'],
    ['<img src="media/../../x.png">', 'image path traversal'],
    ['<img src="media/' . $md5 . '.svg">', 'svg image'],
    ['<p>a</div>', 'mismatched close'],
    ['<p>a', 'unclosed element'],
    ['<p>a < b</p>', 'raw less-than'],
    ['<p>&copy;</p>', 'unknown entity'],
    ['<p class="evil">a</p>', 'unknown class'],
    ['<img src="media/' . $md5 . '.png" class="cms-align-left">', 'wrong class for image'],
    ['<img src="media/' . $md5 . '.png" class="cms-w-33">', 'width not in 5 percent steps'],
    ['<img src="media/' . $md5 . '.png" class="cms-w-105">', 'width above 100 percent'],
    ['<br/>', 'self closing syntax'],
    ['<p href="#/x">a</p>', 'attribute on wrong tag'],
    ["<p>a\x01</p>", 'control character'],
    ['<iframe src="x"></iframe>', 'iframe'],
    ['<p class="cms-align-left" class="cms-align-right">a</p>', 'duplicate attribute'],
    ['<p>' . ('a' x 50001) . '</p>', 'too long'],
);
for my $case (@badHtml) {
    isnt(FHEMCMS_ValidateHtml($case->[0]), undef, "rejects html: $case->[1]");
}

my $hw = {schemaVersion => 2, pages => [{id => 'p', title => 'P', widgets => [
    {id => 'h1', type => 'text', html => '<p>ok</p>', grid => {col => 1, row => 1, w => 4, h => 2}}]}]};
is(FHEMCMS_ValidateConfig($hw), undef, 'config with an html text widget is valid');
$hw->{pages}[0]{widgets}[0]{html} = '<script>x</script>';
like(FHEMCMS_ValidateConfig($hw), qr/Ungueltiger HTML-Text/, 'config with unsafe html is rejected');
$hw->{pages}[0]{widgets}[0]{html} = '<p>ok</p>';
$hw->{pages}[0]{widgets}[0]{markdown} = 'x';
isnt(FHEMCMS_ValidateConfig($hw), undef, 'a text widget cannot carry markdown and html');

# media
my $png = "\x89PNG\r\n\x1a\n" . ("\0" x 32);
my $mediaB64 = MIME::Base64::encode_base64($png, '');
my $mediaRes = FHEMCMS_Set($pHash, $pName, 'media', $mediaB64);
like($mediaRes, qr{\Amedia/[0-9a-f]{32}\.png\z}, 'media upload returns a relative path');
my $mediaFile = File::Spec->catfile($pPage, $mediaRes);
ok(-f $mediaFile, 'media file is stored below the page folder');
is(read_file($mediaFile), $png, 'media content is unchanged');
is(FHEMCMS_Set($pHash, $pName, 'media', $mediaB64), $mediaRes, 'same upload returns the same name');
is(FHEMCMS_Get($pHash, $pName, 'media'), '["' . substr($mediaRes, 6) . '"]', 'get media lists the file');
is(FHEMCMS_ValidateHtml("<p><img src=\"$mediaRes\"></p>"), undef, 'uploaded media path is valid html');
like(FHEMCMS_Set($pHash, $pName, 'media', MIME::Base64::encode_base64("<svg xmlns='x'><script/></svg>" . ('a' x 20), '')),
    qr/Nur PNG/, 'media rejects svg');
like(FHEMCMS_Set($pHash, $pName, 'media', MIME::Base64::encode_base64("GIF89a" . ("\0" x 20), '')) , qr{\.gif\z}, 'media accepts gif');
like(FHEMCMS_Set($pHash, $pName, 'media', MIME::Base64::encode_base64("\xff\xd8\xff" . ("\0" x 20), '')), qr{\.jpg\z}, 'media stores jpeg as jpg');
like(FHEMCMS_Set($pHash, $pName, 'media', 'not base64!'), qr/Base64/, 'media rejects invalid base64');
like(FHEMCMS_Set($pHash, $pName, 'media', 'AAAA'), qr/leer/, 'media rejects tiny files');
{
    local $main::FHEMCMS_MAX_MEDIA_BYTES = 40;
    like(FHEMCMS_Set($pHash, $pName, 'media', MIME::Base64::encode_base64($png . ("\0" x 64), '')),
        qr/zu gross/, 'media rejects oversized files');
}
{
    local $main::FHEMCMS_MAX_MEDIA_FILES = 1;
    like(FHEMCMS_Set($pHash, $pName, 'media', MIME::Base64::encode_base64("\x89PNG\r\n\x1a\n" . ("\1" x 32), '')),
        qr/hoechstens 1 Bilder/, 'media limits the number of files');
}
like(FHEMCMS_Set($pHash, $pName, 'media'), qr/genau einen/, 'media needs a parameter');

write_file(File::Spec->catfile($pPage, 'media', 'evil.txt'), 'x');
like(FHEMCMS_Set($pHash, $pName, 'purge', $pName), qr/fremde Dateien/, 'purge refuses foreign files in the media folder');
unlink(File::Spec->catfile($pPage, 'media', 'evil.txt'));
is(FHEMCMS_Set($pHash, $pName, 'purge', $pName), undef, 'purge removes pages with media');
ok(!-e $pPage, 'media folder is removed with the page');
FHEMCMS_Define($pHash, "$pName FHEMCMS");

# text: Platzhalter im Textbaustein
{
    my $tcfg = {schemaVersion => 2, pages => [{id => 'p', title => 'P', widgets => [{id => 'x1', type => 'text',
        html => '<p>Es sind {{Garten:temperature|round(1)|suffix( C)}} Grad.</p><table><tbody><tr><td>{{Lamp:state|map(on=An,off=Aus)}}</td></tr></tbody></table>',
        grid => {col => 1, row => 1, w => 3, h => 2}}]}]};
    is(FHEMCMS_ValidateConfig($tcfg), undef, 'text accepts placeholders');
    $tcfg->{pages}[0]{widgets}[0]{html} = '<p>' . join(' ', map { "{{Dev$_:state}}" } 1 .. 21) . '</p>';
    isnt(FHEMCMS_ValidateConfig($tcfg), undef, 'text rejects more than 20 placeholder devices');
    $tcfg->{pages}[0]{widgets}[0]{html} = '<p>' . join(' ', map { "{{Dev" . ($_ % 20) . ":state}}" } 1 .. 40) . '</p>';
    is(FHEMCMS_ValidateConfig($tcfg), undef, 'text accepts repeated placeholder devices');
}

# fhem-html: freies HTML mit Platzhaltern
{
    my $hcfg = {schemaVersion => 2, pages => [{id => 'p', title => 'P', widgets => [{id => 'h1', type => 'fhem-html',
        html => '<div class="a">{{Temp:temperature|round(1)}}</div><style>.a{color:red}</style>', devices => ['Temp'],
        grid => {col => 1, row => 1, w => 3, h => 2}}]}]};
    is(FHEMCMS_ValidateConfig($hcfg), undef, 'fhem-html accepts safe html');
    my $w = $hcfg->{pages}[0]{widgets}[0];
    $w->{html} = '<span data-cms-class="Temp:temperature>25:hot; Lamp:state=on:an">x</span>';
    is(FHEMCMS_ValidateConfig($hcfg), undef, 'fhem-html accepts conditions');
    for my $good ('<span device="Temp" reading="temperature"></span>', '<td device="Temp" reading="@alias" filter="round(1)|suffix( C)">-</td>',
        '<span device="Temp" reading="state" filter="map(on=An,off=Aus)"></span>', '<p title="a device=b">x</p>') {
        $w->{html} = $good;
        is(FHEMCMS_ValidateConfig($hcfg), undef, "fhem-html accepts: $good");
    }
    for my $bad ('<script>alert(1)</script>', '<img src="x">', '<div onclick="x()">a</div>', '<a href="javascript:x">a</a>',
        '<iframe src="x"></iframe>', '<div style="background:url(x)">a</div>', '<div style="position:fixed">a</div>',
        '<style>@import "x";</style>', '<!-- c -->', '<div', '<div data-x="1">a</div>', "<p>a\x01</p>",
        '<span data-cms-class="bad">x</span>', 'a < b',
        '<span device="Temp">x</span>', '<span reading="a">x</span>', '<span device="a b" reading="c"></span>',
        '<span device="a" reading="c d"></span>', '<span device="a" reading="c" filter="x(<b>)"></span>',
        '<span device="a" reading="c" filter="round(1"></span>', '<span device="a" reading="c" onclick="x()"></span>', '<div class="a b>c">x</div>') {
        $w->{html} = $bad;
        isnt(FHEMCMS_ValidateConfig($hcfg), undef, "fhem-html rejects: $bad");
    }
    $w->{html} = 'x' x 20001;
    isnt(FHEMCMS_ValidateConfig($hcfg), undef, 'fhem-html rejects too long html');
    $w->{html} = 'ok';
    for my $devices ('Temp', ['a b'], [map { "D$_" } 1 .. 21], ['A', 'A']) {
        $w->{devices} = $devices;
        isnt(FHEMCMS_ValidateConfig($hcfg), undef, 'fhem-html rejects invalid devices');
    }
    $w->{devices} = [];
    is(FHEMCMS_ValidateConfig($hcfg), undef, 'fhem-html accepts no devices');
    $w->{device} = 'X';
    isnt(FHEMCMS_ValidateConfig($hcfg), undef, 'fhem-html rejects unknown fields');
}

# fhem-switch: Zustand, Befehle und Icons
{
    my $scfg = {schemaVersion => 2, pages => [{id => 'p', title => 'P', widgets => [{id => 's1', type => 'fhem-switch',
        device => 'Lamp', reading => 'state', on => 'on', off => 'off', icon => 'light_on', iconOff => 'light_off',
        title => 'Lampe', grid => {col => 1, row => 1, w => 3, h => 2}}]}]};
    is(FHEMCMS_ValidateConfig($scfg), undef, 'fhem-switch accepts a complete config');
    my $w = $scfg->{pages}[0]{widgets}[0];
    for my $case (['on', 'on off'], ['off', 'off;shutdown'], ['on', 'off'], ['reading', 'a b'], ['device', 'x y'],
        ['icon', '../x'], ['iconOff', '/etc']) {
        my ($field, $bad) = @$case;
        my $old = $w->{$field};
        $w->{$field} = $bad;
        isnt(FHEMCMS_ValidateConfig($scfg), undef, "fhem-switch rejects $field=$bad");
        $w->{$field} = $old;
    }
    $w->{extra} = 1;
    isnt(FHEMCMS_ValidateConfig($scfg), undef, 'fhem-switch rejects unknown fields');
    delete $w->{extra};
    delete $w->{off};
    isnt(FHEMCMS_ValidateConfig($scfg), undef, 'fhem-switch requires off');
}

# fhem-value: Einheit und Icon
{
    my $vcfg = {schemaVersion => 2, pages => [{id => 'p', title => 'P', widgets => [{id => 'v1', type => 'fhem-value',
        device => 'Temp', reading => 'temperature', unit => '°C', icon => 'temp_temperature',
        grid => {col => 1, row => 1, w => 3, h => 1}}]}]};
    is(FHEMCMS_ValidateConfig($vcfg), undef, 'fhem-value accepts unit and icon');
    my $w = $vcfg->{pages}[0]{widgets}[0];
    delete @$w{qw(unit icon)};
    is(FHEMCMS_ValidateConfig($vcfg), undef, 'unit and icon are optional');
    for my $case (['unit', '', 'empty unit'], ['unit', 'x' x 17, 'long unit'], ['unit', "a\nb", 'unit with control char'],
        ['icon', '../etc/passwd', 'icon path traversal'], ['icon', 'a b', 'icon with space'], ['icon', '/abs', 'absolute icon'],
        ['icon', '', 'empty icon']) {
        $w->{$case->[0]} = $case->[1];
        isnt(FHEMCMS_ValidateConfig($vcfg), undef, "rejects $case->[2]");
        delete $w->{$case->[0]};
    }
    $w->{title} = 'Wohnzimmer';
    is(FHEMCMS_ValidateConfig($vcfg), undef, 'fhem-value accepts an optional title');
    for my $bad ('x' x 65, "a\nb") {
        $w->{title} = $bad;
        isnt(FHEMCMS_ValidateConfig($vcfg), undef, 'fhem-value rejects an invalid title');
    }
    delete $w->{title};
    $w->{icon} = 'weather/sunny';
    is(FHEMCMS_ValidateConfig($vcfg), undef, 'icon may contain a subdirectory');
}

my $iconDir = File::Spec->catdir($modPath, 'www', 'images', 'default', 'sub');
make_path($iconDir);
write_file(File::Spec->catfile($modPath, 'www', 'images', 'default', 'lamp.svg'), '<svg/>');
write_file(File::Spec->catfile($iconDir, 'door.png'), 'x');
write_file(File::Spec->catfile($modPath, 'www', 'images', 'default', 'notes.txt'), 'x');
write_file(File::Spec->catfile($modPath, 'www', 'images', 'default', 'bad name.svg'), 'x');
is_deeply([FHEMCMS_ListIcons()], ['lamp', 'sub/door'], 'lists logical icon names without extension and invalid files');
like(FHEMCMS_Get({NAME => $name}, $name, 'icons'), qr/\["lamp","sub\/door"\]/, 'get icons returns JSON');

done_testing();
