use strict;
use warnings;
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use Test::More;

our (%attr, $FW_ME);
my @logs;
sub Log3 { push(@logs, [@_]); }
sub CommandAttr { return undef; }
require './FHEM/01_FHEMCMS.pm';

my $root = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($root, 'www'));
$attr{global}{modpath} = $root;
my $json = JSON::PP->new->utf8->canonical;

sub write_bytes {
    my ($path, $bytes) = @_;
    open(my $out, '>:raw', $path) or die "Cannot open test file: $!";
    print {$out} $bytes or die "Cannot write test file: $!";
    close($out) or die "Cannot close test file: $!";
}

sub read_bytes {
    my ($path) = @_;
    my ($bytes, $error) = FHEMCMS_ReadFile($path);
    die "Cannot read test file: $error" if (defined($error));
    return $bytes;
}

sub fixture {
    my ($name, $draft, $version) = @_;
    $version //= 4;
    my $dir = File::Spec->catdir($root, 'fhem-cms-data', $name);
    make_path($dir);
    my $config = {
        schemaVersion => $version, theme => 'light',
        settings => {gridColumns => 24, layoutMode => 'free', showFrames => JSON::PP::false},
        pages => [{id => 'start', title => 'Live', widgets => [
            {id => 'text', type => 'text', html => '<p>{{Temp:temperature|round(1)}}</p>',
                grid => {col => 2, row => 1000, w => 3, h => 999}},
            {id => 'html', type => 'fhem-html', devices => ['Temp'],
                html => '<span device="Temp" reading="temperature"></span>',
                grid => {col => 1, row => 1, w => 48, h => 999}},
        ]}, {id => 'empty', title => 'Empty', widgets => []}],
    };
    if ($version < 3) {
        $_->{grid} = {col => 1, row => 1, w => 12, h => 1} for @{$config->{pages}[0]{widgets}};
    }
    my $live = $json->encode($config);
    write_bytes(File::Spec->catfile($dir, 'config.json'), $live);
    my $draftBytes;
    if ($draft) {
        my $copy = $json->decode($live);
        $copy->{pages}[0]{title} = 'Draft';
        pop(@{$copy->{pages}[0]{widgets}});
        $draftBytes = $json->encode($copy);
        write_bytes(File::Spec->catfile($dir, 'draft.json'), $draftBytes);
    }
    return ($dir, $live, $draftBytes);
}

for my $version (1 .. 4) {
    subtest "one command preserves schema $version live and draft" => sub {
        my $name = "Upgrade$version";
        my ($dir, $live, $draft) = fixture($name, 1, $version);
        my $hash = {NAME => $name};
        my $result = $json->decode(FHEMCMS_Set($hash, $name, 'layoutupgrade'));
        is($result->{schemaVersion}, 5, 'one command returns schema 5');
        is(read_bytes(File::Spec->catfile($dir, $result->{backup})), $live, 'live backup is byte-exact');
        is(read_bytes(File::Spec->catfile($dir, $result->{draftBackup})), $draft, 'draft backup is byte-exact');
        isnt($result->{backup}, $result->{draftBackup}, 'distinct backup files');
        my ($state, $error) = FHEMCMS_ReadVersion5State($dir);
        is($error, undef, 'both configurations are valid schema 5');
        is($state->{live}{pages}[0]{title}, 'Live', 'live remains unpublished');
        is($state->{draft}{pages}[0]{title}, 'Draft', 'draft remains separate');
        is(scalar(@{$state->{live}{pages}[0]{widgets}}), 2, 'all live widgets retained');
        is(scalar(@{$state->{draft}{pages}[0]{widgets}}), 1, 'draft widget selection retained');
        like($state->{live}{pages}[0]{widgets}[0]{html}, qr/\{\{Temp:temperature/, 'text placeholder retained');
        like($state->{live}{pages}[0]{widgets}[1]{html}, qr/device="Temp" reading="temperature"/, 'HTML placeholder retained');
        is($state->{live}{pages}[1]{id}, 'empty', 'empty page retained');
        is($state->{live}{settings}{showFrames}, JSON::PP::false, 'display setting retained');
        my $published = read_bytes(File::Spec->catfile($dir, 'config.json'));
        my $again = $json->decode(FHEMCMS_Set($hash, $name, 'layoutupgrade'));
        is($again->{backup}, undef, 'repeated command is a no-op');
        is(read_bytes(File::Spec->catfile($dir, 'config.json')), $published, 'repeat does not change layout');
        ok(!FHEMCMS_UpgradePending($dir), 'no pending journal');
        is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'device restarts with converted draft');
        my ($restarted, $restartError) = FHEMCMS_ReadVersion5State($dir);
        is($restartError, undef, 'state readable after restart');
        is_deeply($restarted, $state, 'restart preserves both configurations');
    };
}

subtest 'no draft and invalid data' => sub {
    my ($dir) = fixture('NoDraft', 0);
    my ($result, $error) = FHEMCMS_UpgradeLayout($dir);
    is($error, undef, 'upgrade without draft succeeds');
    is($result->{draftBackup}, undef, 'no draft backup invented');
    ok(!-e File::Spec->catfile($dir, 'draft.json'), 'no draft invented');
    my ($badDir, $original) = fixture('BadDraft', 1);
    write_bytes(File::Spec->catfile($badDir, 'draft.json'), '{');
    (undef, $error) = FHEMCMS_UpgradeLayout($badDir);
    like($error, qr/draft.json.*JSON/, 'invalid draft rejected explicitly');
    is(read_bytes(File::Spec->catfile($badDir, 'config.json')), $original, 'invalid draft leaves live unchanged');
    my @invalidBackups = FHEMCMS_ListBackups($badDir);
    is(scalar(@invalidBackups), 0, 'validation fails before any backup or write');
    unlink(File::Spec->catfile($badDir, 'draft.json')) or die $!;
    symlink(File::Spec->catfile($badDir, 'config.json'), File::Spec->catfile($badDir, 'draft.json')) or die $!;
    (undef, $error) = FHEMCMS_UpgradeLayout($badDir);
    like($error, qr/Symlink/, 'draft symlink rejected');
    like(FHEMCMS_Set({NAME => 'NoDraft'}, 'NoDraft', 'layoutupgrade', 'extra'), qr/keine Parameter/, 'rejects extra input');
    unlike(FHEMCMS_Set({NAME => 'NoDraft'}, 'NoDraft', '?'), qr/(?:version5draft|migrationcommit)/,
        'internal write contracts no longer advertised in FHEM dropdown');
    like(FHEMCMS_Set({NAME => 'NoDraft'}, 'NoDraft', 'version5draft'), qr/interner Befehl.*CMS-Editor/,
        'direct draft invocation is explained');
};

subtest 'interrupted two-file replacement resumes only the original transaction' => sub {
    my ($dir, $live, $draft) = fixture('Interrupted', 1);
    my $writer = \&FHEMCMS_WriteUpgradeFile;
    {
        no warnings 'redefine';
        local *FHEMCMS_WriteUpgradeFile = sub {
            my ($path, $bytes, $replace) = @_;
            if ($path =~ /draft\.json\z/) {
                write_bytes("$path.upgrade.tmp", substr($bytes, 0, 40));
                return 'simulated interruption';
            }
            return $writer->(@_);
        };
        my (undef, $error) = FHEMCMS_UpgradeLayout($dir);
        like($error, qr/simulated interruption.*unvollstaendig/, 'partial replacement explicitly reported');
    }
    ok(FHEMCMS_UpgradePending($dir), 'journal preserved');
    is($json->decode(read_bytes(File::Spec->catfile($dir, 'config.json')))->{schemaVersion}, 5, 'live already replaced');
    is(read_bytes(File::Spec->catfile($dir, 'draft.json')), $draft, 'draft still original');
    like(FHEMCMS_Get({NAME => 'Interrupted'}, 'Interrupted', 'config'), qr/unvollstaendig/, 'legacy reads blocked while pending');
    my (undef, $stateError) = FHEMCMS_ReadVersion5State($dir);
    like($stateError, qr/unvollstaendig/, 'versioned reads blocked while pending');
    like(FHEMCMS_Set({NAME => 'Interrupted'}, 'Interrupted', 'discard'), qr/unvollstaendig/, 'old writes blocked');
    is(FHEMCMS_Define({NAME => 'Interrupted'}, 'Interrupted FHEMCMS'), undef, 'restart completes journal');
    my ($state, $error) = FHEMCMS_ReadVersion5State($dir);
    is($error, undef, 'completed state readable');
    is($state->{draft}{pages}[0]{title}, 'Draft', 'draft content retained after crash');
    ok(!FHEMCMS_UpgradePending($dir), 'completed journal removed');
    ok(!-e File::Spec->catfile($dir, 'draft.json.upgrade.tmp'), 'partial temporary file recovered');
};

subtest 'changed files and failed backups never get overwritten' => sub {
    my ($dir, $original) = fixture('Changed', 1);
    {
        no warnings 'redefine';
        local *FHEMCMS_WriteUpgradeFile = sub { return 'simulated prepare failure'; };
        my (undef, $error) = FHEMCMS_UpgradeLayout($dir);
        like($error, qr/prepare failure/, 'journal creation failure surfaced');
    }
    is(read_bytes(File::Spec->catfile($dir, 'config.json')), $original, 'prepare failure leaves live untouched');
    my ($backupDir, $backupOriginal) = fixture('BackupFailure', 1);
    {
        no warnings 'redefine';
        local *FHEMCMS_CreateMigrationBackup = sub { return (undef, 'simulated backup failure'); };
        my (undef, $error) = FHEMCMS_UpgradeLayout($backupDir);
        like($error, qr/backup failure/, 'backup failure surfaced');
    }
    is(read_bytes(File::Spec->catfile($backupDir, 'config.json')), $backupOriginal, 'backup failure leaves live untouched');
    my $writer = \&FHEMCMS_WriteUpgradeFile;
    {
        no warnings 'redefine';
        local *FHEMCMS_WriteUpgradeFile = sub {
            my $error = $writer->(@_);
            if ($_[0] =~ /layout-upgrade\.json\z/ && !defined($error)) {
                write_bytes(File::Spec->catfile($dir, 'draft.json'), 'external change');
            }
            return $error;
        };
        my (undef, $error) = FHEMCMS_UpgradeLayout($dir);
        like($error, qr/JSON|ausserhalb/, 'external draft change prevents replacement');
    }
    is(read_bytes(File::Spec->catfile($dir, 'config.json')), $original, 'all files checked before first replacement');
    is(read_bytes(File::Spec->catfile($dir, 'draft.json')), 'external change', 'external content not overwritten');
    ok(FHEMCMS_UpgradePending($dir), 'journal retained for manual investigation');
};

done_testing();
