use strict;
use warnings;
use File::Spec;
use File::Path qw(make_path);
use File::Temp qw(tempdir);
use IO::Compress::Gzip qw(gzip $GzipError);
use POSIX qw(tzset);
use Time::Local qw(timelocal);
use Test::More;

require './FHEM/01_FHEMCMS.pm';

our ($FHEMCMS_LOG_INDEX_MAX_PAIRS, $FHEMCMS_LOG_INDEX_MAX_LINE_BYTES);

SKIP: {
    skip 'DBI und DBD::SQLite fuer isolierten DbLog-Test erforderlich', 7
        if (!eval { require DBI; require DBD::SQLite; 1 });
    my $setup = DBI->connect('dbi:SQLite:dbname=:memory:', '', '',
        {RaiseError => 1, PrintError => 0});
    $setup->do('CREATE TABLE history (DEVICE TEXT, READING TEXT, VALUE TEXT, TIMESTAMP TEXT)');
    my $insert = $setup->prepare('INSERT INTO history VALUES (?, ?, ?, ?)');
    $insert->execute('Shelly_Solar_Garage', 'power', '12', '2025-01-01');
    $insert->execute('Shelly_Solar_Garage', 'power', '15', '2026-01-01');
    $insert->execute('Shelly_Solar_Garage', 'state', 'on', '2026-01-01');
    $insert->execute('other', 'power', '1', '2026-01-01');
    $insert->execute('invalid device', 'bad', '1', '2026-01-01');
    no warnings 'redefine';
    local *main::_DbLog_getNewDBHandle = sub { return $setup; };
    local *DBI::db::disconnect = sub { return 1; };
    my $log = {NAME => 'db', TYPE => 'DbLog', HELPER => {TH => 'history'}};
    my ($index, $error) = FHEMCMS_LogIndexDb($log);
    is($error, undef, 'grouped DbLog lookup succeeds');
    is_deeply($index, {Shelly_Solar_Garage => {power => 1, state => 1},
        other => {power => 1}}, 'deduplicates and includes text values across devices');
    {
        local $FHEMCMS_LOG_INDEX_MAX_PAIRS = 1;
        ($index, $error) = FHEMCMS_LogIndexDb($log);
        like($error, qr/Zu viele/, 'limit failure is explicit');
        ok(!defined($index), 'incomplete index is not returned');
    }
    $log->{HELPER}{TH} = 'history; DROP TABLE history';
    ($index, $error) = FHEMCMS_LogIndexDb($log);
    like($error, qr/Tabelle ist ungueltig/, 'rejects unsafe table identifiers');
    $log->{HELPER}{TH} = 'missing';
    ($index, $error) = FHEMCMS_LogIndexDb($log);
    is($error, 'DbLog-Index konnte nicht gelesen werden', 'SQL errors are sanitized');
    ok(!defined($index), 'failed query cannot replace existing index');
}

my $dir = tempdir(CLEANUP => 1);
my $plain = File::Spec->catfile($dir, 'current.log');
my $archive = File::Spec->catfile($dir, 'old.log.gz');
my $content = "2024-01-01_12:00:00 Solar power: 12\n"
    . "2024-01-01_12:00:01.123 Solar state: on\n"
    . "2024-01-01_12:00:02 Solar on\n";
open(my $out, '>:raw', $plain) or die $!;
print {$out} $content or die $!;
close($out) or die $!;
my $archived = "2010-01-01_00:00:00 Solar energy: 7\n";
gzip(\$archived => $archive) or die $GzipError;
my $archiveDir = File::Spec->catdir($dir, 'archive');
make_path($archiveDir);
my $oldFile = File::Spec->catfile($archiveDir, 'solar-2010-01.log.gz');
gzip(\$archived => $oldFile) or die $GzipError;
my $currentFile = File::Spec->catfile($dir, 'solar-2026-11.log');
open(my $current, '>:raw', $currentFile) or die $!;
print {$current} $content or die $!;
close($current) or die $!;
my $fileLog = {TYPE => 'FileLog', logfile => '%L/solar-%Y-%m.log'};
my ($discovered, $discoveryError) = FHEMCMS_LogIndexDiscoverFiles(
    $fileLog, {archivedir => $archiveDir}, $dir);
is($discoveryError, undef, 'discovers configured log and archive paths');
is_deeply($discovered, [sort ($oldFile, $currentFile)], 'discovers all matching years and compressed archives');
($discovered, $discoveryError) = FHEMCMS_LogIndexDiscoverFiles(
    $fileLog, {archivecmd => 'external'}, $dir);
ok(!defined($discovered), 'unknown archive command is not treated as complete');
like($discoveryError, qr/archivecmd/, 'unsupported external archiving is reported');
($discovered, $discoveryError) = FHEMCMS_LogIndexDiscoverFiles(
    {TYPE => 'FileLog', logfile => '%L/%Y/solar.log'}, {}, $dir);
like($discoveryError, qr/Zeitabhaengige/, 'unsupported dynamic directories are reported');
my ($built, $buildError) = FHEMCMS_LogIndexBuild(
    [{%{$fileLog}, NAME => 'file_solar'}], {file_solar => {archivedir => $archiveDir}}, $dir, 1735689600);
is($buildError, undef, 'builds index for a configured source');
is_deeply($built->{sources}{filelog}{file_solar}{Solar}, {power => 1, state => 1, energy => 1},
    'shared index keeps source identity and includes archived entries');
my ($selected, $selectionError) = FHEMCMS_LogIndexSelect($built, 'filelog', ['file_solar'], 'Solar');
is($selectionError, undef, 'configured source can be selected from the shared cache');
is_deeply($selected, [qw(energy power state)], 'selection returns matching readings');
($selected, $selectionError) = FHEMCMS_LogIndexSelect($built, 'filelog', ['other'], 'Solar');
ok(!defined($selected), 'unknown configured source is not treated as an empty result');
like($selectionError, qr/fehlt im Cache/, 'missing source requests a rebuild');
my $previousBuild = $built;
($built, $buildError) = FHEMCMS_LogIndexBuild(
    [{%{$fileLog}, NAME => 'file_solar'}], {file_solar => {archivecmd => 'external'}}, $dir, 1735689600,
    $previousBuild);
is($buildError, undef, 'individual source failure does not block other sources');
is_deeply($built->{sources}{filelog}{file_solar}, $previousBuild->{sources}{filelog}{file_solar},
    'failed source retains its previous data');
like($built->{errors}{filelog}{file_solar}, qr/archivecmd/, 'failed source is identified');
my $warnings;
($selected, $selectionError, $warnings) = FHEMCMS_LogIndexSelect($built, 'filelog', ['file_solar'], 'Solar');
is_deeply($selected, [qw(energy power state)], 'last successful data remain available');
is($selectionError, undef, 'stale data are returned with a warning instead of an error');
like($warnings->[0], qr/veraltet/, 'stale source is explicitly reported');
my ($fileIndex, $fileError) = FHEMCMS_LogIndexFiles([$plain, $archive]);
is($fileError, undef, 'plain and compressed logs are read');
is_deeply($fileIndex, {Solar => {power => 1, state => 1, energy => 1}},
    'file index includes text readings, millisecond timestamps and archives');
($fileIndex, $fileError) = FHEMCMS_LogIndexFiles([$plain, File::Spec->catfile($dir, 'missing')]);
ok(!defined($fileIndex), 'missing file does not return a partial index');
like($fileError, qr/FileLog-Datei/, 'missing file is reported');
my $badArchive = File::Spec->catfile($dir, 'broken.log.gz');
open(my $broken, '>:raw', $badArchive) or die $!;
print {$broken} "not gzip\n" or die $!;
close($broken) or die $!;
($fileIndex, $fileError) = FHEMCMS_LogIndexFiles([$plain, $badArchive]);
ok(!defined($fileIndex), 'invalid archive does not return a partial index');
like($fileError, qr/FileLog-Datei/, 'invalid archive is reported');
my $truncatedArchive = File::Spec->catfile($dir, 'truncated.log.gz');
open(my $inputArchive, '<:raw', $archive) or die $!;
my $gzipBytes = do { local $/; <$inputArchive> };
close($inputArchive) or die $!;
open(my $truncatedOut, '>:raw', $truncatedArchive) or die $!;
print {$truncatedOut} substr($gzipBytes, 0, length($gzipBytes) - 5) or die $!;
close($truncatedOut) or die $!;
($fileIndex, $fileError) = FHEMCMS_LogIndexFiles([$plain, $truncatedArchive]);
ok(!defined($fileIndex), 'truncated archive does not return a partial index');
like($fileError, qr/FileLog-Datei/, 'truncated archive is reported');
my $noNewline = File::Spec->catfile($dir, 'no-newline.log');
open(my $withoutNewline, '>:raw', $noNewline) or die $!;
print {$withoutNewline} '2024-01-01_00:00:00 Solar power: 123' or die $!;
close($withoutNewline) or die $!;
($fileIndex, $fileError) = FHEMCMS_LogIndexFiles([$noNewline]);
is_deeply($fileIndex, {Solar => {power => 1}}, 'last line without newline is indexed');
{
    local $FHEMCMS_LOG_INDEX_MAX_LINE_BYTES = 16;
    ($fileIndex, $fileError) = FHEMCMS_LogIndexFiles([$plain]);
    like($fileError, qr/Zeile ist zu gross/, 'oversized line is rejected');
    ok(!defined($fileIndex), 'oversized line does not yield an incomplete index');
}
{
    local $FHEMCMS_LOG_INDEX_MAX_PAIRS = 1;
    ($fileIndex, $fileError) = FHEMCMS_LogIndexFiles([$plain]);
    like($fileError, qr/Zu viele/, 'file index pair limit is reported');
    ok(!defined($fileIndex), 'limited file index is not returned');
}
my $cache = {version => 1, builtAt => 1735689600,
    sources => {dblog => {db => {Solar => {power => 1}}}, filelog => {fl => {Solar => {state => 1}}}}};
is(FHEMCMS_LogIndexWrite($dir, $cache), undef, 'writes shared source-partitioned cache');
my ($saved, $readError) = FHEMCMS_LogIndexRead($dir);
is($readError, undef, 'persisted cache is readable');
is_deeply($saved, $cache, 'cache retains its source identities');
my $bad = {version => 1, builtAt => 1735689600,
    sources => {dblog => {db => {Solar => {'bad reading' => 1}}}, filelog => {}}};
like(FHEMCMS_LogIndexWrite($dir, $bad), qr/Reading/, 'invalid index is rejected');
($saved, $readError) = FHEMCMS_LogIndexRead($dir);
is_deeply($saved, $cache, 'failed write leaves the previous cache intact');
{
    local $ENV{TZ} = 'Europe/Berlin';
    tzset();
    for my $day ([2026, 3, 28], [2026, 10, 24]) {
        my ($year, $month, $date) = @{$day};
        my $now = timelocal(0, 0, 4, $date, $month - 1, $year);
        my $next = FHEMCMS_LogIndexNextBuild($now);
        my @parts = localtime($next);
        is_deeply([@parts[0, 1, 2]], [0, 0, 3], 'next build remains at 03:00 across DST change');
        is($parts[3], $date + 1, 'next build uses the following local calendar day');
    }
    my $now = timelocal(0, 0, 2, 15, 0, 2026);
    my @parts = localtime(FHEMCMS_LogIndexNextBuild($now));
    is_deeply([@parts[0, 1, 2, 3]], [0, 0, 3, 15], 'before 03:00 schedule today');
}
tzset();
done_testing();
