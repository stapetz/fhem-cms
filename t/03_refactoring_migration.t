use strict;
use warnings;

use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use MIME::Base64 qw(encode_base64);
use Test::More;

our (%attr, $FW_ME);

sub CommandAttr {
    my ($client, $definition) = @_;
    my ($name, $attribute, $value) = split(/\s+/, $definition, 3);
    $attr{$name}{$attribute} = $value;
    return undef;
}

sub Log3 { return; }

require './FHEM/01_FHEMCMS.pm';

my $modPath = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($modPath, 'www'));
$attr{global}{modpath} = $modPath;
my $json = JSON::PP->new->utf8->canonical;

sub read_bytes {
    my ($path) = @_;
    open(my $in, '<:raw', $path) or die "Cannot open $path: $!";
    my $contents = do { local $/; <$in> };
    close($in) or die "Cannot close $path: $!";
    return $contents;
}

sub write_bytes {
    my ($path, $contents) = @_;
    open(my $out, '>:raw', $path) or die "Cannot open $path: $!";
    print {$out} $contents or die "Cannot write $path: $!";
    close($out) or die "Cannot close $path: $!";
}

for my $version (1 .. 3) {
    subtest "schema $version lifecycle" => sub {
        my $name = "Migration$version";
        my $hash = {NAME => $name};
        is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
        my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
        my $livePath = File::Spec->catfile($dir, 'config.json');
        my $draftPath = File::Spec->catfile($dir, 'draft.json');
        my $widget = {
            type => 'fhem-value', device => 'Test', reading => 'state',
            grid => {col => 3, row => 2, w => 5, h => 3},
        };
        $widget->{id} = 'value' if ($version > 1);
        my $legacy = {
            schemaVersion => $version,
            settings => {gridColumns => 12},
            navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
            pages => [{id => 'start', title => 'Live', widgets => [$widget]}],
        };
        my $draft = $json->decode($json->encode($legacy));
        $draft->{pages}[0]{title} = 'Draft';
        my $liveBytes = $json->encode($legacy);
        my $draftBytes = $json->encode($draft);
        write_bytes($livePath, $liveBytes);
        write_bytes($draftPath, $draftBytes);

        my $expectedGrid = $version < 3
            ? {col => 9, row => 2, w => 20, h => 3}
            : {col => 3, row => 2, w => 5, h => 3};
        my $expectedNav = $version < 3
            ? {col => 1, row => 1, w => 48, h => 1}
            : {col => 1, row => 1, w => 12, h => 1};
        my $migrated;
        for my $iteration (1 .. 2) {
            $migrated = $json->decode(FHEMCMS_Get($hash, $name, 'config'));
            my $readDraft = $json->decode(FHEMCMS_Get($hash, $name, 'draft'));
            is($migrated->{schemaVersion}, 4, "read $iteration returns schema 4");
            is_deeply($migrated->{pages}[0]{widgets}[0]{grid}, $expectedGrid, "read $iteration preserves widget geometry");
            is_deeply($migrated->{navigation}{grid}, $expectedNav, "read $iteration preserves navigation geometry");
            is($migrated->{pages}[0]{widgets}[0]{id}, $version == 1 ? 'w1' : 'value', "read $iteration preserves or assigns ID");
            is($migrated->{settings}{gridColumns}, 12, "read $iteration retains editing grid setting");
            is($readDraft->{pages}[0]{title}, 'Draft', "read $iteration keeps draft separate");
            is_deeply($readDraft->{pages}[0]{widgets}[0]{grid}, $expectedGrid, "draft read $iteration preserves geometry");
        }
        is(read_bytes($livePath), $liveBytes, 'reading does not rewrite legacy live data');
        is(read_bytes($draftPath), $draftBytes, 'reading does not rewrite legacy draft');
        my $draftV4 = $json->decode(FHEMCMS_Get($hash, $name, 'draft'));
        is(FHEMCMS_Set($hash, $name, 'draft', encode_base64($json->encode($draftV4), '')), undef, 'explicitly saves migrated draft');
        is(FHEMCMS_Set($hash, $name, 'publish'), undef, 'publishes migrated draft');
        is_deeply($json->decode(FHEMCMS_Get($hash, $name, 'config')), $draftV4, 'published draft survives roundtrip');
        my @backups = FHEMCMS_ListBackups($dir);
        my @original = grep { read_bytes(File::Spec->catfile($dir, $_)) eq $liveBytes } @backups;
        is(scalar(@original), 1, 'backup preserves original legacy bytes');
        is(FHEMCMS_Set($hash, $name, 'draft', encode_base64($json->encode($draftV4), '')), undef, 'creates draft before restore');
        is(FHEMCMS_Set($hash, $name, 'restore', $original[0]), undef, 'restores legacy backup');
        is_deeply($json->decode(FHEMCMS_Get($hash, $name, 'config')), $migrated, 'restored live matches migrated original');
        is_deeply($json->decode(FHEMCMS_Get($hash, $name, 'draft')), $draftV4, 'restore leaves draft intact');
    };
}

subtest 'unsupported and invalid persisted data fails closed' => sub {
    my $name = 'InvalidData';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $livePath = File::Spec->catfile($dir, 'config.json');
    my $draftPath = File::Spec->catfile($dir, 'draft.json');
    my $backupName = 'config.json.20000101-000000.bak';
    my $backupPath = File::Spec->catfile($dir, $backupName);
    my $original = read_bytes($livePath);
    my $future = $json->decode($original);
    $future->{schemaVersion} = 5;

    for my $case (
        ['future schema', $json->encode($future), qr/schemaVersion/],
        ['invalid JSON', '{', qr/JSON/],
    ) {
        my ($label, $bytes, $error) = @{$case};
        write_bytes($draftPath, $bytes);
        like(FHEMCMS_Get($hash, $name, 'draft'), $error, "$label draft cannot be read");
        like(FHEMCMS_Set($hash, $name, 'publish'), $error, "$label draft cannot be published");
        is(read_bytes($livePath), $original, "$label publish leaves live bytes unchanged");
        is(read_bytes($draftPath), $bytes, "$label publish leaves draft bytes unchanged");
        write_bytes($backupPath, $bytes);
        like(FHEMCMS_Set($hash, $name, 'restore', $backupName), $error, "$label backup cannot be restored");
        is(read_bytes($livePath), $original, "$label restore leaves live bytes unchanged");
        is(read_bytes($draftPath), $bytes, "$label restore leaves draft bytes unchanged");
        is(read_bytes($backupPath), $bytes, "$label restore leaves backup bytes unchanged");
        like(FHEMCMS_Set($hash, $name, 'config', encode_base64($bytes, '')), $error, "$label live write is rejected");
        like(FHEMCMS_Set($hash, $name, 'draft', encode_base64($bytes, '')), $error, "$label draft write is rejected");
        is(read_bytes($livePath), $original, "$label rejected writes leave live unchanged");
        is(read_bytes($draftPath), $bytes, "$label rejected writes leave draft unchanged");
        write_bytes($livePath, $bytes);
        like(FHEMCMS_Get($hash, $name, 'config'), $error, "$label live cannot be read");
        is(read_bytes($livePath), $bytes, "$label failed read leaves live bytes unchanged");
        write_bytes($livePath, $original);
    }
};

done_testing();
