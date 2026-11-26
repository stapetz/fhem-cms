use strict;
use warnings;
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use Test::More;

our (%attr, %defs, $FHEMCMS_LOG_INDEX_JOB, $FHEMCMS_LOG_INDEX_ERROR);
my ($workerArgument, $startFails);
my (@timers, @removedTimers);
sub Log3 { return; }
sub InternalTimer { push(@timers, [@_]); return; }
sub RemoveInternalTimer { push(@removedTimers, [@_]); return; }
sub BlockingCall {
    $workerArgument = $_[1];
    return undef if ($startFails);
    return {pid => 123};
}

require './FHEM/01_FHEMCMS.pm';

my $root = tempdir(CLEANUP => 1);
my $dataDir = File::Spec->catdir($root, 'fhem-cms-data');
my $logDir = File::Spec->catdir($root, 'log');
make_path($dataDir, $logDir);
$attr{global} = {modpath => $root, logdir => $logDir};
my $logfile = File::Spec->catfile($logDir, 'solar-2026.log');
open(my $out, '>:raw', $logfile) or die $!;
print {$out} "2026-01-01_00:00:00 Solar power: 12\n" or die $!;
close($out) or die $!;
$defs{File_Solar} = {NAME => 'File_Solar', TYPE => 'FileLog', logfile => '%L/solar-%Y.log'};

FHEMCMS_LogIndexSchedule();
is(scalar(@timers), 1, 'schedules a single global daily timer');
is($timers[0][1], 'FHEMCMS_LogIndexTimer', 'daily timer uses cache callback');
FHEMCMS_LogIndexSchedule();
is(scalar(@removedTimers), 2, 'repeated scheduling replaces the previous timer');
is(FHEMCMS_LogIndexStart(), undef, 'starts one asynchronous index job');
like(FHEMCMS_LogIndexStart(), qr/laeuft bereits/, 'coalesces concurrent index jobs');
my $result = FHEMCMS_LogIndexWorker($workerArgument);
ok(!-e File::Spec->catfile($dataDir, 'log-index.json'), 'worker cannot publish directly');
FHEMCMS_LogIndexDone($result);
ok(!$FHEMCMS_LOG_INDEX_JOB, 'completion clears the running job');
is($FHEMCMS_LOG_INDEX_ERROR, undef, 'successful build has no error');
my ($cache, $error) = FHEMCMS_LogIndexRead($dataDir);
is($error, undef, 'completed cache is available');
is_deeply($cache->{sources}{filelog}{File_Solar}{Solar}, {power => 1}, 'cache has logged readings');
is($cache->{fingerprint}, FHEMCMS_LogIndexFingerprint(), 'cache identifies its source configuration');
my $readings = JSON::PP::decode_json(FHEMCMS_LogIndexReadings('CMS', 'Solar', 'filelog'));
is_deeply($readings->{readings}, ['power'], 'cached readings are available to a CMS');
is_deeply($readings->{warnings}, [], 'current cache has no warnings');
my $devices = JSON::PP::decode_json(FHEMCMS_LogIndexDevices('CMS', 'filelog', ['Solar']));
is_deeply($devices->{devices}, ['Solar'], 'one cache query returns all logged devices');
$devices = JSON::PP::decode_json(FHEMCMS_LogIndexDevices('CMS', 'filelog', []));
is_deeply($devices->{devices}, [], 'bulk cache query cannot expose unauthorized devices');
$attr{OtherCMS}{fileLog} = 'File_Solar';
$readings = JSON::PP::decode_json(FHEMCMS_LogIndexReadings('OtherCMS', 'Solar', 'filelog'));
is_deeply($readings->{readings}, ['power'], 'a second CMS can use the same source cache');
$attr{OtherCMS}{fileLog} = 'MissingLog';
like(FHEMCMS_LogIndexReadings('OtherCMS', 'Solar', 'filelog'), qr/Kein DbLog- oder FileLog/,
    'CMS-specific source configuration is respected');
delete($attr{OtherCMS});
{
    local $defs{DB} = {NAME => 'DB', TYPE => 'DbLog', HELPER => {TH => 'history'}};
    my $mixed = {
        %{$cache},
        sources => {
            dblog => {DB => {Solar => {energy => 1}}},
            filelog => $cache->{sources}{filelog},
        },
        errors => {dblog => {}, filelog => {}},
        fingerprint => FHEMCMS_LogIndexFingerprint(),
    };
    is(FHEMCMS_LogIndexWrite($dataDir, $mixed), undef, 'prepares a shared multi-source index');
    $readings = JSON::PP::decode_json(FHEMCMS_LogIndexReadings('CMS', 'Solar', 'auto'));
    is_deeply($readings->{readings}, [qw(energy power)], 'auto mode combines DbLog and FileLog readings');
    is($readings->{source}, 'mixed', 'mixed reading results identify both sources');
    $readings = JSON::PP::decode_json(FHEMCMS_LogIndexReadings('CMS', 'Solar', 'dblog'));
    is_deeply($readings->{readings}, ['energy'], 'explicit DbLog excludes FileLog');
    $readings = JSON::PP::decode_json(FHEMCMS_LogIndexReadings('CMS', 'Solar', 'filelog'));
    is_deeply($readings->{readings}, ['power'], 'explicit FileLog excludes DbLog');
    $mixed->{errors}{filelog}{File_Solar} = 'Lesefehler';
    is(FHEMCMS_LogIndexWrite($dataDir, $mixed), undef, 'persists a source failure alongside old data');
    $readings = JSON::PP::decode_json(FHEMCMS_LogIndexReadings('CMS', 'Solar', 'auto'));
    is_deeply($readings->{readings}, [qw(energy power)], 'old readings survive a source failure');
    like($readings->{warnings}[0], qr/veraltet/, 'source failure is visible on selection');
}
is(FHEMCMS_LogIndexWrite($dataDir, $cache), undef, 'restores original cache for job tests');

is(FHEMCMS_LogIndexStart(), undef, 'starts rebuild');
$result = FHEMCMS_LogIndexWorker($workerArgument);
$defs{File_Solar}{logfile} = '%L/other-%Y.log';
FHEMCMS_LogIndexDone($result);
like($FHEMCMS_LOG_INDEX_ERROR, qr/geaendert/, 'changed source configuration rejects publication');
my ($previous) = FHEMCMS_LogIndexRead($dataDir);
is_deeply($previous, $cache, 'rejected rebuild preserves old cache');

is(FHEMCMS_LogIndexStart(), undef, 'starts job for timeout test');
FHEMCMS_LogIndexAbort($workerArgument);
like($FHEMCMS_LOG_INDEX_ERROR, qr/Zeitlimit/, 'timeout is surfaced');
ok(!$FHEMCMS_LOG_INDEX_JOB, 'timeout clears job');
$startFails = 1;
like(FHEMCMS_LogIndexStart(), qr/nicht gestartet/, 'worker startup failure is surfaced');
ok(!$FHEMCMS_LOG_INDEX_JOB, 'startup failure clears job');
$startFails = 0;
is(FHEMCMS_LogIndexStart(), undef, 'starts job for invalid callback test');
FHEMCMS_LogIndexDone('invalid');
like($FHEMCMS_LOG_INDEX_ERROR, qr/ungueltige Antwort/, 'invalid callback is surfaced');
ok(!$FHEMCMS_LOG_INDEX_JOB, 'invalid callback clears job');
my $cacheFile = File::Spec->catfile($dataDir, 'log-index.json');
open(my $corrupt, '>:raw', $cacheFile) or die $!;
print {$corrupt} '{invalid' or die $!;
close($corrupt) or die $!;
is(FHEMCMS_LogIndexStart(), undef, 'starts job with corrupt previous cache');
$result = FHEMCMS_LogIndexWorker($workerArgument);
FHEMCMS_LogIndexDone($result);
like($FHEMCMS_LOG_INDEX_ERROR, qr/Vorheriger Cache ungueltig/, 'corrupt previous cache is reported');
open(my $readCorrupt, '<:raw', $cacheFile) or die $!;
my $corruptText = do { local $/; <$readCorrupt> };
close($readCorrupt) or die $!;
is($corruptText, '{invalid', 'corrupt previous cache is not silently replaced');
{
    local $attr{global}{modpath} = '';
    my ($dir, $rootError) = FHEMCMS_LogIndexRoot();
    ok(!defined($dir), 'missing modpath cannot silently use current directory');
    like($rootError, qr/modpath/, 'missing modpath is reported');
}
done_testing();
