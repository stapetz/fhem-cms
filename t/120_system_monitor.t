use strict;
use warnings;
use Test::More;
use JSON::PP ();
use Cwd qw(abs_path);
use File::Temp qw(tempdir);
use File::Spec;
use MIME::Base64 qw(decode_base64);
our (%defs, $FW_chash);
my @jobs;
my @messages;
sub Log3 { push(@messages, [@_]); }
sub Authorized { return $_[2] ne 'Hidden'; }
sub BlockingCall { push(@jobs, [@_]); return {pid => 123}; }
require './FHEM/01_FHEMCMS.pm';

my $widget = {
    id => 'system', type => 'system-monitor', systemDevice => 'Local',
    title => 'System', grid => {col => 1, row => 2, w => 6, h => 8},
};
my $config = {
    schemaVersion => 5, theme => 'dark',
    settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [{id => 'start', title => 'Start', widgets => [$widget]}],
};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'schema 5 accepts system monitor');
$widget->{hiddenMetrics} = ['ram', 'root'];
is(FHEMCMS_ValidateConfig($config, 5), undef, 'schema 5 accepts hidden metric keys');
is(FHEMCMS_ValidateBlueprints([{name => 'Monitor', widget => $widget}]), undef, 'blueprint accepts system monitor');
$config->{schemaVersion} = 6;
is(FHEMCMS_ValidateConfig($config, 6), undef, 'schema 6 grid accepts system monitor');
delete($widget->{grid});
$widget->{rect} = {x => 0, y => 0, w => 200, h => 100};
$config->{pages}[0]{layoutMode} = 'freeform';
$config->{pages}[0]{canvas} = {width => 200, height => 200};
is(FHEMCMS_ValidateConfig($config, 6), undef, 'schema 6 freeform accepts system monitor');
for my $invalid (undef, {}, 'ram', ['ram','ram'], ['fs_root'], ['bad'], [undef], [[]]) {
    $widget->{hiddenMetrics} = $invalid;
    like(FHEMCMS_ValidateConfig($config, 6), qr/Auswahl der Systemwerte/, 'invalid metric selection rejected');
}
$widget->{hiddenMetrics} = ['ram','root'];
delete($widget->{rect});
$widget->{grid} = {col => 1, row => 2, w => 6, h => 8};
delete($config->{pages}[0]{layoutMode});
delete($config->{pages}[0]{canvas});
$config->{schemaVersion} = 5;
$widget->{systemDevice} = '';
is(FHEMCMS_ValidateConfig($config, 5), undef, 'missing source is an explicit choice');
for my $invalid ('../bad', 'bad;set', "bad\nname", [], undef) {
    $widget->{systemDevice} = $invalid;
    like(FHEMCMS_ValidateConfig($config, 5), qr/Systemquelle/, 'invalid system source rejected');
}
$widget->{systemDevice} = 'Local';
$widget->{unexpected} = 1;
ok(defined(FHEMCMS_ValidateConfig($config, 5)), 'unknown widget field rejected');
delete($widget->{unexpected});
my $dir = abs_path(tempdir(CLEANUP => 1));
my $json = JSON::PP->new->utf8->canonical;
my $live = $json->encode({%{$config}, pages => [{id => 'start', title => 'Start', widgets => []}]});
open(my $liveFile, '>', File::Spec->catfile($dir, 'config.json')) or die $!;
print {$liveFile} $live;
close($liveFile) or die $!;
my ($state, $stateError) = FHEMCMS_ReadVersion5State($dir);
is($stateError, undef, 'reads isolated live configuration');
is(FHEMCMS_WriteVersion5Draft($dir, $config, $state->{token}), undef, 'stores monitor through real draft writer');
($state, $stateError) = FHEMCMS_ReadVersion5State($dir);
is_deeply($state->{draft}{pages}[0]{widgets}[0], $widget, 'reload preserves monitor configuration');
is_deeply($state->{live}{pages}[0]{widgets}, [], 'saving monitor leaves live unchanged');

my $file = File::Spec->catfile($dir, 'current.log');
open(my $fh, '>', $file) or die $!;
print {$fh} 'abc';
close($fh) or die $!;
my $link = File::Spec->catfile($dir, 'linked.log');
symlink($file, $link) or die $!;
my ($sizes, $error) = FHEMCMS_SystemLogSizes([
    {name => 'File', type => 'FileLog', path => $file},
    {name => 'Missing', type => 'FileLog', path => "$file.missing"},
    {name => 'Link', type => 'FileLog', path => $link},
    {name => 'Invalid', type => 'FileLog', path => "bad\npath"},
]);
is($error, undef, 'file measurements return per-source availability');
my $result = $json->decode($sizes);
is($result->{items}[0]{bytes}, 3, 'current log size is exact bytes');
ok($result->{checkedAt} > 0 && $result->{items}[0]{modifiedAt} > 0, 'measurement and modification timestamps present');
like($result->{items}[1]{error}, qr/fehlt/, 'missing file explicit');
like($result->{items}[2]{error}, qr/Symlink/, 'symlink rejected');
like($result->{items}[3]{error}, qr/gueltige/, 'control characters rejected');
ok(!exists($result->{items}[0]{path}), 'filesystem path not exposed');
($sizes, $error) = FHEMCMS_SystemLogSizes([map { {} } 1 .. 101]);
like($error, qr/Logdateiliste/, 'bounded number of sources');
local %defs = (
    File => {TYPE => 'FileLog', currentlogfile => $file},
    Hidden => {TYPE => 'FileLog', currentlogfile => $file},
    global => {TYPE => 'Global', currentlogfile => $file},
    Database => {TYPE => 'DbLog'},
);
local $FW_chash = {};
my $pending = $json->decode(FHEMCMS_Get({NAME => 'CMS'}, 'CMS', 'systemlogs'));
is($pending->{status}, 'pending', 'measurements start in background');
is(scalar(@jobs), 1, 'one background job');
my $request = $json->decode(decode_base64($jobs[0][1]));
is_deeply([map { $_->{name} } @{$request->{logs}}], ['File', 'global'], 'permissions exclude hidden devices and DbLog');
FHEMCMS_Get({NAME => 'CMS'}, 'CMS', 'systemlogs');
is(scalar(@jobs), 1, 'parallel requests share job');
FHEMCMS_HistoryDone(FHEMCMS_HistoryWorker($jobs[0][1]));
my $cached = $json->decode(FHEMCMS_Get({NAME => 'CMS'}, 'CMS', 'systemlogs'));
is($cached->{items}[0]{bytes}, 3, 'polling returns completed measurement');
is(scalar(@jobs), 1, 'completed results cached');
like(FHEMCMS_Get({NAME => 'CMS'}, 'CMS', 'systemlogs', '/etc/passwd'), qr/keine Parameter/, 'user-supplied paths rejected');
done_testing();
