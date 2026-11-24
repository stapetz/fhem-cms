use strict;
use warnings;

use File::Copy qw(copy);
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use MIME::Base64 qw(encode_base64);
use Test::More;

our %attr;
sub Log3 { return; }
require './FHEM/01_FHEMCMS.pm';

my $root = tempdir(CLEANUP => 1);
my $mediaDir = File::Spec->catdir($root, 'www', 'fhem-cms', 'CMS', 'media');
make_path($mediaDir);
$attr{global}{modpath} = $root;
my ($error, $dataDir, $created) = FHEMCMS_CreateDataDir('CMS');
is($error, undef, 'creates CMS data directory');
is(FHEMCMS_EnsureConfig('CMS', $dataDir, $created), undef, 'sets up schema 5');

my $mediaName = ('a' x 32) . '.png';
my $mediaPath = File::Spec->catfile($mediaDir, $mediaName);
open(my $mediaFile, '>:raw', $mediaPath) or die $!;
print {$mediaFile} "image bytes\n";
close($mediaFile) or die $!;

my ($initial) = FHEMCMS_ReadVersion5State($dataDir);
my $json = JSON::PP->new->canonical;
my $draft5 = $json->decode($json->encode($initial->{live}));
$draft5->{pages}[0]{title} = 'Grid draft';
$draft5->{pages}[0]{kiosk} = JSON::PP::true;
$draft5->{pages}[0]{overrideBackground} = JSON::PP::false;
$draft5->{navigation}{style} = 'cards';
$draft5->{settings}{pageCanvas} = {width => 200, height => 200};
$draft5->{settings}{pageNavigationRect} = {x => 10, y => 10, w => 180, h => 40};
is(FHEMCMS_WriteVersion5Draft($dataDir, $draft5, $initial->{token}, 1), undef, 'grid-only save stays schema 5');
my ($gridState) = FHEMCMS_ReadVersion5State($dataDir);
is($gridState->{draft}{pages}[0]{kiosk}, JSON::PP::true, 'kiosk flag survives schema 5 draft round trip');
is($gridState->{draft}{pages}[0]{overrideBackground}, JSON::PP::false, 'false background exception survives schema 5 draft round trip');
is($gridState->{draft}{navigation}{style}, 'cards', 'navigation style survives schema 5 draft round trip');
ok(!exists($gridState->{live}{navigation}{style}), 'draft navigation style leaves legacy live configuration unchanged');
ok(!exists($gridState->{live}{pages}[0]{kiosk}), 'draft kiosk flag does not change live configuration');
is_deeply($gridState->{draft}{settings}, $draft5->{settings}, 'common frame persists in a grid-only draft');
my $livePath = File::Spec->catfile($dataDir, 'config.json');
my $draftPath = File::Spec->catfile($dataDir, 'draft.json');
my ($originalLive) = FHEMCMS_ReadFile($livePath);
my ($originalDraft) = FHEMCMS_ReadFile($draftPath);
my $next = $json->decode($json->encode($draft5));
$next->{schemaVersion} = 6;
$next->{navigation}{style} = 'tabs';
like(FHEMCMS_WriteVersion5Draft($dataDir, $next, $gridState->{token}, 1), qr/mindestens eine Freeform-Seite/,
    'grid-only schema bump refused');
$next->{pages}[0]{layoutMode} = 'freeform';
$next->{pages}[0]{background} = "media/$mediaName";
$next->{pages}[0]{canvas} = {width => 200, height => 200};
$next->{pages}[0]{renderAsPins} = JSON::PP::true;
$next->{pages}[0]{backgroundDim} = 0.25;
$next->{pages}[0]{overrideBackground} = JSON::PP::true;
$next->{pages}[0]{widgets} = [{
    id => 'pin', type => 'text', markdown => 'Pin card', forceCard => JSON::PP::false,
    rect => {x => 20, y => 60, w => 100, h => 100},
}, {
    id => 'temperature', type => 'fhem-value', device => 'Demo', reading => 'temperature',
    showOnPin => {reading => JSON::PP::false}, rect => {x => 120, y => 60, w => 80, h => 100},
    position => {centerX => 0, centerY => 100},
}];
like(FHEMCMS_WriteVersion5Draft($dataDir, $next, $initial->{token}, 1), qr/veraltet/, 'stale upgrade refused');
like(FHEMCMS_WriteVersion5Draft($dataDir, $next, $gridState->{token}), qr/schemaVersion/, 'old writer cannot introduce schema 6');
my $bad = $json->decode($json->encode($next));
for my $invalid (undef, 0, 1, 'true', [], {}) {
    $bad->{pages}[0]{overrideBackground} = $invalid;
    like(FHEMCMS_WriteVersion5Draft($dataDir, $bad, $gridState->{token}, 1), qr/Hintergrundvererbung/,
        'non-Boolean background exception refused before persistence');
}
$bad = $json->decode($json->encode($next));
for my $invalid (undef, [], {}, {centerX => '50', centerY => 50}, {centerX => -1, centerY => 50},
    {centerX => 101, centerY => 50}, {centerX => 42.123, centerY => 50},
    {centerX => 50, centerY => JSON::PP::true}, {centerX => 50, centerY => 50, extra => 1}) {
    $bad->{pages}[0]{widgets}[1]{position} = $invalid;
    like(FHEMCMS_WriteVersion5Draft($dataDir, $bad, $gridState->{token}, 1), qr/Pin-Position/,
        'invalid Pin percentages refused before persistence');
}
$bad = $json->decode($json->encode($next));
$bad->{pages}[0]{canvas}{width} = 199;
like(FHEMCMS_WriteVersion5Draft($dataDir, $bad, $gridState->{token}, 1), qr/canvas\.width/, 'invalid pixels prevent saving');
rename($mediaDir, "$mediaDir.saved") or die $!;
symlink("$mediaDir.saved", $mediaDir) or die $!;
like(FHEMCMS_WriteVersion5Draft($dataDir, $next, $gridState->{token}, 1), qr/Medienverzeichnis ist ein Symlink/,
    'cannot upgrade if the media snapshot cannot be created safely');
unlink($mediaDir) or die $!;
rename("$mediaDir.saved", $mediaDir) or die $!;
my ($stillGrid) = FHEMCMS_ReadVersion5State($dataDir);
is($stillGrid->{token}, $gridState->{token}, 'invalid and unsafely backed up upgrades leave both files unchanged');
my $hash = {NAME => 'CMS'};
is(FHEMCMS_Set($hash, 'CMS', 'version6draft', 'save', $gridState->{token}, encode_base64($json->encode($next), '')),
    undef, 'public versioned command saves first schema 6 draft');
my @snapshots = glob("$dataDir/freeform-rollback-*");
is(scalar(@snapshots), 1, 'one rollback snapshot created');
my ($snapshotLive) = FHEMCMS_ReadFile(File::Spec->catfile($snapshots[0], 'config.json'));
my ($snapshotDraft) = FHEMCMS_ReadFile(File::Spec->catfile($snapshots[0], 'draft.json'));
is($snapshotLive, $originalLive, 'snapshot contains byte-exact previous live');
is($snapshotDraft, $originalDraft, 'snapshot contains byte-exact previous draft');
unlink($mediaPath) or die $!;
my ($snapshotMedia) = FHEMCMS_ReadFile(File::Spec->catfile($snapshots[0], 'media', $mediaName));
is($snapshotMedia, "image bytes\n", 'snapshot media survives removal of original directory entry');

my $staged = $json->decode(FHEMCMS_Get($hash, 'CMS', 'version6state'));
is($staged->{live}{schemaVersion}, 5, 'live unchanged while schema 6 is a draft');
is_deeply($staged->{draft}, $next, 'read preserves freeform data');
my (undef, $oldError) = FHEMCMS_ReadVersion5State($dataDir);
like($oldError, qr/schemaVersion/, 'old state read refuses schema 6');
like(FHEMCMS_DiscardVersion5Draft($dataDir, $staged->{token}), qr/schemaVersion/, 'old client cannot discard newer draft');
like(FHEMCMS_WriteVersion5Draft($dataDir, $draft5, $staged->{token}, 1), qr/nicht auf Schema 5/, 'downgrade is refused');
is(FHEMCMS_Set($hash, 'CMS', 'version6draft', 'publish', $staged->{token}), undef, 'public schema 6 publish succeeds');
my ($backup) = FHEMCMS_ListBackups($dataDir);
my ($previousLive) = FHEMCMS_ReadFile(File::Spec->catfile($dataDir, $backup));
is($previousLive, $originalLive, 'publish also creates the ordinary live backup');
my ($published) = FHEMCMS_ReadVersion5State($dataDir, 1);
is_deeply($published->{live}, $next, 'published state contains exact schema 6 config');
is($published->{draft}, undef, 'published draft was removed');
is($json->decode(FHEMCMS_Get($hash, 'CMS', 'layoutformat'))->{schemaVersion}, 6, 'published format is discoverable');
my ($preview, $restoreToken, $previewError) = FHEMCMS_PreviewMigrationRestore($dataDir, $backup);
is($previewError, undef, 'restore can preview a schema 5 backup while live is schema 6');
is($preview, $originalLive, 'restore preview retains original bytes');
my ($freeformBackup, $migrationError) = FHEMCMS_CommitMigrationRestore($dataDir, $backup, $restoreToken);
is($migrationError, undef, 'restoring schema 5 creates a backup of schema 6');
my ($schema6Preview, $schema6Token, $schema6Error) = FHEMCMS_PreviewMigrationRestore($dataDir, $freeformBackup);
is($schema6Error, undef, 'schema 6 backup can be previewed from schema 5');
is_deeply($json->decode($schema6Preview), $next, 'schema 6 backup preserves geometry and references');
my (undef, $reapplyError) = FHEMCMS_CommitMigrationRestore($dataDir, $freeformBackup, $schema6Token);
is($reapplyError, undef, 'schema 6 backup round-trips');

copy(File::Spec->catfile($snapshots[0], 'config.json'), $livePath) or die $!;
copy(File::Spec->catfile($snapshots[0], 'draft.json'), $draftPath) or die $!;
copy(File::Spec->catfile($snapshots[0], 'media', $mediaName), $mediaPath) or die $!;
my ($restored, $restoreError) = FHEMCMS_ReadVersion5State($dataDir);
is($restoreError, undef, 'simulated offline rollback is readable by schema 5');
is($restored->{token}, $gridState->{token}, 'offline rollback restores identical live and draft bytes');
my ($restoredMedia) = FHEMCMS_ReadFile($mediaPath);
is($restoredMedia, $snapshotMedia, 'offline rollback restores media bytes');

my $longDraft = $json->decode($json->encode($restored->{draft}));
my $longHtml = chr(0x1f600) x 50000;
push(@{$longDraft->{pages}[0]{widgets}}, {
    id => 'longhtml', type => 'fhem-html', html => $longHtml, devices => [],
    grid => {col => 1, row => 10, w => 4, h => 3},
});
is(FHEMCMS_WriteVersion5Draft($dataDir, $longDraft, $restored->{token}, 1), undef,
    '50000 Unicode characters can be saved in a free HTML widget');
my ($longState, $longError) = FHEMCMS_ReadVersion5State($dataDir, 1);
is($longError, undef, 'long HTML draft can be reloaded');
is($longState->{draft}{pages}[0]{widgets}[-1]{html}, $longHtml, 'long HTML survives the draft round trip');
$longDraft->{pages}[0]{widgets}[-1]{html} .= 'x';
like(FHEMCMS_WriteVersion5Draft($dataDir, $longDraft, $longState->{token}, 1), qr/zu lang/,
    '50001 characters are rejected by the draft writer');
my ($afterLongError) = FHEMCMS_ReadVersion5State($dataDir, 1);
is($afterLongError->{token}, $longState->{token}, 'rejected oversized HTML does not modify the draft');

done_testing();
