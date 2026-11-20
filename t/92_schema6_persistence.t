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
$draft5->{settings}{pageCanvas} = {width => 200, height => 200};
$draft5->{settings}{pageNavigationRect} = {x => 10, y => 10, w => 180, h => 40};
is(FHEMCMS_WriteVersion5Draft($dataDir, $draft5, $initial->{token}, 1), undef, 'grid-only save stays schema 5');
my ($gridState) = FHEMCMS_ReadVersion5State($dataDir);
is_deeply($gridState->{draft}{settings}, $draft5->{settings}, 'common frame persists in a grid-only draft');
my $livePath = File::Spec->catfile($dataDir, 'config.json');
my $draftPath = File::Spec->catfile($dataDir, 'draft.json');
my ($originalLive) = FHEMCMS_ReadFile($livePath);
my ($originalDraft) = FHEMCMS_ReadFile($draftPath);
my $next = $json->decode($json->encode($draft5));
$next->{schemaVersion} = 6;
like(FHEMCMS_WriteVersion5Draft($dataDir, $next, $gridState->{token}, 1), qr/mindestens eine Freeform-Seite/,
    'grid-only schema bump refused');
$next->{pages}[0]{layoutMode} = 'freeform';
$next->{pages}[0]{background} = "media/$mediaName";
$next->{pages}[0]{canvas} = {width => 200, height => 200};
like(FHEMCMS_WriteVersion5Draft($dataDir, $next, $initial->{token}, 1), qr/veraltet/, 'stale upgrade refused');
like(FHEMCMS_WriteVersion5Draft($dataDir, $next, $gridState->{token}), qr/schemaVersion/, 'old writer cannot introduce schema 6');
my $bad = $json->decode($json->encode($next));
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

done_testing();
