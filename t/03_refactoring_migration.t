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

subtest 'prepares a fully specified target without writing or accepting schema 5' => sub {
    my $grid = sub { return {col => $_[0], row => $_[1], w => $_[2], h => $_[3]}; };
    my $source = {
        schemaVersion => 4, theme => 'light', settings => {layoutMode => 'flow', showFrames => JSON::PP::true},
        pages => [
            {id => 'a', title => 'Erste', widgets => [
                {id => 'text', type => 'text', html => '<p>{{Temp:state}}</p>', grid => $grid->(2, 1, 7, 2)},
                {id => 'html', type => 'fhem-html', devices => ['Temp'],
                    html => '<span device="Temp" reading="state"></span>', grid => $grid->(20, 1, 8, 2)},
            ]},
            {id => 'b', title => 'Zweite', widgets => [
                {id => 'text', type => 'text', markdown => 'Zweiter Text', grid => $grid->(1, 2, 8, 2)},
            ]},
        ],
    };
    my $plan = {
        navigation => $grid->(1, 1, 12, 1),
        pages => [
            {id => 'b', widgets => [{id => 'text', grid => $grid->(1, 2, 2, 2)}]},
            {id => 'a', widgets => [
                {id => 'html', grid => $grid->(3, 2, 2, 2)},
                {id => 'text', grid => $grid->(1, 2, 2, 2)},
            ]},
        ],
    };
    my $before_source = $json->encode($source);
    my $before_plan = $json->encode($plan);
    my ($candidate, $error) = FHEMCMS_PrepareLayoutMigration($source, $plan);
    is($error, undef, 'valid plan produces a candidate');
    is($candidate->{schemaVersion}, 5, 'candidate has a distinct schema');
    is_deeply($candidate->{navigation}, {orientation => 'horizontal', grid => $plan->{navigation}},
        'materializes the legacy default navigation');
    is_deeply($candidate->{settings}, {layoutMode => 'grid', gridColumns => 12, showFrames => JSON::PP::true},
        'freezes the previewed geometry and retains other settings');
    is_deeply($candidate->{pages}[0]{widgets}[0]{grid}, $plan->{pages}[1]{widgets}[1]{grid},
        'matches widget positions by page and ID rather than plan order');
    is($candidate->{pages}[0]{widgets}[0]{html}, $source->{pages}[0]{widgets}[0]{html}, 'retains text placeholder');
    is($candidate->{pages}[0]{widgets}[1]{html}, $source->{pages}[0]{widgets}[1]{html}, 'retains HTML binding');
    is($json->encode($source), $before_source, 'source is unchanged');
    is($json->encode($plan), $before_plan, 'plan is unchanged');
    like(FHEMCMS_ValidateConfig($candidate), qr/schemaVersion/, 'existing validator does not accept candidate');
    is(FHEMCMS_ValidateConfig($candidate, 5), undef, 'explicit internal validator accepts the candidate');
    is_deeply($json->decode($json->encode($candidate)), $candidate, 'target JSON roundtrip preserves content');
    my $target_bytes = $json->encode($candidate);
    for my $case (
        ['missing navigation', sub { delete $_[0]{navigation} }],
        ['missing settings', sub { delete $_[0]{settings} }],
        ['wrong layout', sub { $_[0]{settings}{layoutMode} = 'flow' }],
        ['wrong column count', sub { $_[0]{settings}{gridColumns} = 48 }],
        ['wrong schema', sub { $_[0]{schemaVersion} = 4 }],
        ['column overflow', sub { $_[0]{pages}[0]{widgets}[0]{grid}{col} = 12 }],
        ['row overflow', sub { $_[0]{pages}[0]{widgets}[0]{grid}{row} = 1000 }],
        ['navigation collision', sub { $_[0]{pages}[0]{widgets}[0]{grid}{row} = 1 }],
        ['widget collision', sub { $_[0]{pages}[0]{widgets}[1]{grid}{col} = 2 }],
        ['reserved ID', sub { $_[0]{pages}[0]{widgets}[0]{id} = '__nav' }],
        ['unknown widget field', sub { $_[0]{pages}[0]{widgets}[0]{unexpected} = 1 }],
        ['invalid HTML', sub { $_[0]{pages}[0]{widgets}[1]{html} = '<script>x</script>' }],
    ) {
        my $bad = $json->decode($target_bytes);
        $case->[1]->($bad);
        ok(defined(FHEMCMS_ValidateConfig($bad, 5)), "target rejects $case->[0]");
    }
    like(FHEMCMS_ValidateConfig($candidate, 6), qr/Validierungsvertrag/, 'unknown validation contract is rejected');
    my (undef, $parse_error) = FHEMCMS_ParseConfig($json->encode($candidate));
    like($parse_error, qr/schemaVersion/, 'existing API parser does not accept candidate');

    for my $case (
        ['missing navigation', sub { delete $_[0]{navigation} }],
        ['extra plan field', sub { $_[0]{extra} = 1 }],
        ['unknown page', sub { $_[0]{pages}[0]{id} = 'unknown' }],
        ['duplicate page', sub { $_[0]{pages}[0]{id} = 'a' }],
        ['missing widget', sub { pop @{$_[0]{pages}[1]{widgets}} }],
        ['unknown widget', sub { $_[0]{pages}[1]{widgets}[0]{id} = 'unknown' }],
        ['duplicate widget', sub { $_[0]{pages}[1]{widgets}[0]{id} = 'text' }],
        ['column overflow', sub { $_[0]{navigation}{col} = 2 }],
        ['row overflow', sub { $_[0]{navigation}{row} = 1000; $_[0]{navigation}{h} = 2 }],
        ['invalid grid field', sub { $_[0]{navigation}{extra} = 1 }],
        ['navigation collision', sub { $_[0]{pages}[1]{widgets}[0]{grid}{row} = 1 }],
        ['widget collision', sub { $_[0]{pages}[1]{widgets}[0]{grid}{col} = 2 }],
    ) {
        my $bad = $json->decode($before_plan);
        $case->[1]->($bad);
        my ($result, $reason) = FHEMCMS_PrepareLayoutMigration($source, $bad);
        ok(!defined($result) && defined($reason), "$case->[0] is rejected explicitly");
        is($json->encode($source), $before_source, "$case->[0] leaves source unchanged");
    }
    my $invalid = $json->decode($before_source);
    $invalid->{schemaVersion} = 5;
    my ($result, $reason) = FHEMCMS_PrepareLayoutMigration($invalid, $plan);
    ok(!defined($result) && $reason =~ /schemaVersion/, 'rejects already migrated input');
    $invalid = $json->decode($before_source);
    $invalid->{pages}[0]{widgets}[0]{id} = '__nav';
    my $reserved = $json->decode($before_plan);
    $reserved->{pages}[1]{widgets}[1]{id} = '__nav';
    ($result, $reason) = FHEMCMS_PrepareLayoutMigration($invalid, $reserved);
    ok(!defined($result) && $reason =~ /__nav/, 'rejects ambiguous legacy navigation ID');
};

subtest 'legacy commands cannot overwrite or discard a future format' => sub {
    my $name = 'FutureGuard';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $live = File::Spec->catfile($dir, 'config.json');
    my $draft = File::Spec->catfile($dir, 'draft.json');
    my $old = read_bytes($live);
    my $future = $json->decode($old);
    $future->{schemaVersion} = 5;
    my $future_bytes = $json->encode($future);
    my $backup_name = 'config.json.20000101-000000.bak';
    write_bytes(File::Spec->catfile($dir, $backup_name), $old);
    my $payload = encode_base64($old, '');
    for my $location ('live', 'draft') {
        write_bytes($live, $location eq 'live' ? $future_bytes : $old);
        write_bytes($draft, $location eq 'draft' ? $future_bytes : $old);
        my $before_live = read_bytes($live);
        my $before_draft = read_bytes($draft);
        my @backups = FHEMCMS_ListBackups($dir);
        for my $action (
            ['config', $payload], ['draft', $payload], ['publish'], ['discard'], ['restore', $backup_name],
        ) {
            like(FHEMCMS_Set($hash, $name, @{$action}), qr/schemaVersion/,
                "$location: legacy $action->[0] is rejected");
            is(read_bytes($live), $before_live, "$location: $action->[0] preserves live bytes");
            is(read_bytes($draft), $before_draft, "$location: $action->[0] preserves draft bytes");
            is_deeply([FHEMCMS_ListBackups($dir)], \@backups, "$location: $action->[0] creates no backup");
        }
    }
    for my $version ('0', '000001', '99', 'unknown') {
        my $unknown = $json->decode($old);
        $unknown->{schemaVersion} = $version;
        my $bytes = $json->encode($unknown);
        write_bytes($live, $bytes);
        write_bytes($draft, $old);
        like(FHEMCMS_Set($hash, $name, 'config', $payload), qr/schemaVersion/,
            "unknown version $version is protected");
        is(read_bytes($live), $bytes, "unknown version $version remains unchanged");
    }
    unlink($draft) or die "Cannot remove test draft: $!";
    write_bytes($live, '{');
    is(FHEMCMS_Set($hash, $name, 'restore', $backup_name), undef,
        'explicit restore remains possible when live JSON is corrupt');
    is_deeply($json->decode(read_bytes($live)), $json->decode($old), 'restore recovers the legacy configuration');
    my @corrupt = grep { read_bytes(File::Spec->catfile($dir, $_)) eq '{' } FHEMCMS_ListBackups($dir);
    is(scalar(@corrupt), 1, 'restore backs up the corrupt live bytes before replacement');
};

subtest 'preview binds both source bytes and target while refusing a draft' => sub {
    my $name = 'SnapshotPreview';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $live = File::Spec->catfile($dir, 'config.json');
    my $draft = File::Spec->catfile($dir, 'draft.json');
    my $before = read_bytes($live);
    my @backups = FHEMCMS_ListBackups($dir);
    my $positions = {navigation => {col => 1, row => 1, w => 12, h => 1},
        pages => [{id => 'start', widgets => []}]};
    my ($candidate, $token, $error) = FHEMCMS_PreviewLayoutMigration($dir, $positions);
    is($error, undef, 'complete preview succeeds');
    like($token, qr/\A[0-9a-f]{64}\z/, 'returns SHA-256 confirmation digest');
    is($candidate->{schemaVersion}, 5, 'returns internally validated target');
    is(read_bytes($live), $before, 'preview does not rewrite live bytes');
    is_deeply([FHEMCMS_ListBackups($dir)], \@backups, 'preview creates no backup');
    my (undef, $again) = FHEMCMS_PreviewLayoutMigration($dir, $positions);
    is($again, $token, 'same source and plan give same digest');
    my $changed_plan = $json->decode($json->encode($positions));
    $changed_plan->{navigation}{w} = 11;
    my (undef, $other) = FHEMCMS_PreviewLayoutMigration($dir, $changed_plan);
    isnt($other, $token, 'target change invalidates digest');
    write_bytes($live, $before . "\n");
    (undef, $other) = FHEMCMS_PreviewLayoutMigration($dir, $positions);
    isnt($other, $token, 'even a byte-only source change invalidates digest');
    write_bytes($live, $before);
    write_bytes($draft, $before);
    my $draft_before = read_bytes($draft);
    (my $blocked, my $blocked_token, $error) = FHEMCMS_PreviewLayoutMigration($dir, $positions);
    like($error, qr/Entwurf vorhanden/, 'draft blocks preview');
    ok(!defined($blocked) && !defined($blocked_token), 'blocked preview returns no candidate or digest');
    is(read_bytes($draft), $draft_before, 'draft is not changed');
    is(read_bytes($live), $before, 'live is not changed');
    unlink($draft) or die "Cannot remove test draft: $!";
    write_bytes($live, '{');
    (undef, undef, $error) = FHEMCMS_PreviewLayoutMigration($dir, $positions);
    like($error, qr/ungueltig/, 'invalid live is rejected');
    is(read_bytes($live), '{', 'invalid live is not changed');
    is_deeply([FHEMCMS_ListBackups($dir)], \@backups, 'failed previews create no backup');
};

subtest 'internal migration transaction checks preview and preserves original backup' => sub {
    my $name = 'MigrationTransaction';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $live = File::Spec->catfile($dir, 'config.json');
    my $draft = File::Spec->catfile($dir, 'draft.json');
    my $tmp = File::Spec->catfile($dir, 'config.json.migration.tmp');
    my $original = read_bytes($live);
    my $plan = {navigation => {col => 1, row => 1, w => 12, h => 1},
        pages => [{id => 'start', widgets => []}]};
    my ($expected, $token, $error) = FHEMCMS_PreviewLayoutMigration($dir, $plan);
    is($error, undef, 'prepares valid candidate');
    my ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, 'invalid');
    like($reason, qr/Bestaetigung/, 'invalid confirmation rejected');
    is(read_bytes($live), $original, 'invalid confirmation preserves live');
    write_bytes($draft, $original);
    ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    like($reason, qr/Entwurf/, 'new draft blocks transaction');
    is(read_bytes($draft), $original, 'transaction does not touch draft');
    unlink($draft) or die "Cannot remove draft: $!";
    write_bytes($live, $original . "\n");
    ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    like($reason, qr/veraltet/, 'changed live data invalidates preview');
    is(read_bytes($live), $original . "\n", 'stale preview does not rewrite live');
    write_bytes($live, $original);
    write_bytes($tmp, 'foreign temporary file');
    ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    like($reason, qr/Temporaere/, 'existing temporary file blocks transaction');
    is(read_bytes($tmp), 'foreign temporary file', 'existing temporary file is not overwritten');
    unlink($tmp) or die "Cannot remove test temporary file: $!";

    {
        no warnings 'redefine';
        local *main::FHEMCMS_CreateMigrationBackup = sub { return (undef, 'injected backup failure'); };
        ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    }
    like($reason, qr/injected backup failure/, 'backup failure aborts transaction');
    is(read_bytes($live), $original, 'backup failure preserves live');
    ok(!-e $tmp, 'backup failure removes transaction-owned temporary file');

    {
        my $create = \&FHEMCMS_CreateMigrationBackup;
        no warnings 'redefine';
        local *main::FHEMCMS_CreateMigrationBackup = sub {
            my @result = $create->(@_);
            write_bytes($draft, $original);
            return @result;
        };
        ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    }
    like($reason, qr/Entwurf/, 'draft created before commit blocks transaction');
    is(read_bytes($live), $original, 'late draft leaves live untouched');
    is(read_bytes($draft), $original, 'late draft remains untouched');
    ok(!-e $tmp, 'aborted transaction removes its temporary file');
    unlink($draft) or die "Cannot remove draft: $!";

    {
        my $create = \&FHEMCMS_CreateMigrationBackup;
        no warnings 'redefine';
        local *main::FHEMCMS_CreateMigrationBackup = sub {
            my @result = $create->(@_);
            write_bytes($live, $original . "\n");
            return @result;
        };
        ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    }
    like($reason, qr/veraltet/, 'late live change blocks transaction');
    is(read_bytes($live), $original . "\n", 'late live change is preserved');
    ok(!-e $tmp, 'late live change removes transaction-owned temporary file');
    write_bytes($live, $original);

    ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    is($reason, undef, 'commits validated candidate on isolated test data');
    like($backup, qr/\Aconfig\.json\.\d{8}-\d{6}(?:-\d+)?\.bak\z/, 'returns standard backup name');
    is(read_bytes(File::Spec->catfile($dir, $backup)), $original, 'verified backup preserves exact original bytes');
    is_deeply($json->decode(read_bytes($live)), $expected, 'committed target matches preview');
    ok(!-e $tmp, 'successful transaction leaves no temporary file');
    my $originalBackup = $backup;
    ($backup, $reason) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    like($reason, qr/schemaVersion/, 'repeated migration fails closed');
    is_deeply($json->decode(read_bytes($live)), $expected, 'repetition leaves target unchanged');
    like(FHEMCMS_Set($hash, $name, 'config', encode_base64($original, '')), qr/schemaVersion/,
        'legacy client cannot overwrite target');
    my $target = read_bytes($live);
    my ($restoreBytes, $restoreToken, $restoreError) = FHEMCMS_PreviewMigrationRestore($dir, $originalBackup);
    is($restoreError, undef, 'previews restore across schemas');
    is($restoreBytes, $original, 'restore preview retains original bytes');
    write_bytes($draft, $original);
    my ($rollbackBackup, $rollbackError) = FHEMCMS_CommitMigrationRestore($dir, $originalBackup, $restoreToken);
    like($rollbackError, qr/Entwurf/, 'restore refuses an existing draft');
    is(read_bytes($draft), $original, 'restore leaves draft intact');
    is(read_bytes($live), $target, 'blocked restore preserves target');
    unlink($draft) or die "Cannot remove draft: $!";
    write_bytes($live, $target . "\n");
    ($rollbackBackup, $rollbackError) = FHEMCMS_CommitMigrationRestore($dir, $originalBackup, $restoreToken);
    like($rollbackError, qr/veraltet/, 'restore rejects changed source');
    write_bytes($live, $target);
    my $backupPath = File::Spec->catfile($dir, $originalBackup);
    write_bytes($backupPath, $original . "\n");
    ($rollbackBackup, $rollbackError) = FHEMCMS_CommitMigrationRestore($dir, $originalBackup, $restoreToken);
    like($rollbackError, qr/veraltet/, 'restore rejects changed backup');
    write_bytes($backupPath, $original);
    ($rollbackBackup, $rollbackError) = FHEMCMS_CommitMigrationRestore($dir, $originalBackup, $restoreToken);
    is($rollbackError, undef, 'restores original live bytes');
    is(read_bytes($live), $original, 'restore preserves original byte-for-byte');
    is(read_bytes(File::Spec->catfile($dir, $rollbackBackup)), $target, 'restore backs up schema 5 bytes');
    is(read_bytes($backupPath), $original, 'restore does not change original backup');
    my (undef, $redoToken, $redoError) = FHEMCMS_PreviewMigrationRestore($dir, $rollbackBackup);
    is($redoError, undef, 'previews redo from schema 5 backup');
    (my $redoBackup, $redoError) = FHEMCMS_CommitMigrationRestore($dir, $rollbackBackup, $redoToken);
    is($redoError, undef, 'restores schema 5 backup exactly');
    is(read_bytes($live), $target, 'redo preserves schema 5 bytes');
    is(read_bytes(File::Spec->catfile($dir, $redoBackup)), $original, 'redo backs up restored legacy bytes');
    (undef, undef, $restoreError) = FHEMCMS_PreviewMigrationRestore($dir, '../config.json');
    like($restoreError, qr/Backup-Name/, 'restore rejects path traversal');
    write_bytes($backupPath, '{"schemaVersion":99,"pages":[]}');
    (undef, undef, $restoreError) = FHEMCMS_PreviewMigrationRestore($dir, $originalBackup);
    like($restoreError, qr/schemaVersion/, 'restore rejects unknown backup schema');
    is(read_bytes($live), $target, 'invalid backup does not alter live');
};

subtest 'migration transaction preserves widget content and media on isolated data' => sub {
    my $name = 'MigrationContent';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $live = File::Spec->catfile($dir, 'config.json');
    my $media = File::Spec->catdir($modPath, 'www', 'fhem-cms', $name, 'media');
    my $png = "\x89PNG\r\n\x1a\n" . ("\0" x 32);
    my $mediaName = FHEMCMS_Set($hash, $name, 'media', encode_base64($png, ''));
    like($mediaName, qr{\Amedia/[0-9a-f]{32}\.png\z}, 'stores media');
    my $mediaPath = File::Spec->catfile($media, (split m{/}, $mediaName)[1]);
    my $source = {
        schemaVersion => 4, theme => 'light',
        navigation => {orientation => 'vertical', grid => {col => 1, row => 1, w => 4, h => 1},
            items => [{page => 'start', label => 'Home'}]},
        pages => [{id => 'start', title => 'Start', widgets => [
            {id => 'text', type => 'text', html => qq{<p>{{Temp:state}}<img src="$mediaName"></p>},
                grid => {col => 5, row => 2, w => 4, h => 2}},
            {id => 'html', type => 'fhem-html', devices => ['Temp'],
                html => '<div>{{Temp:state}}<span device="Temp" reading="state"></span></div>',
                grid => {col => 9, row => 2, w => 4, h => 2}},
        ]}],
    };
    is(FHEMCMS_Set($hash, $name, 'config', encode_base64($json->encode($source), '')), undef, 'stores source');
    my $original = read_bytes($live);
    my $plan = {
        navigation => {col => 1, row => 1, w => 1, h => 1},
        pages => [{id => 'start', widgets => [
            {id => 'text', grid => {col => 2, row => 2, w => 1, h => 2}},
            {id => 'html', grid => {col => 3, row => 2, w => 1, h => 2}},
        ]}],
    };
    my ($candidate, $token, $error) = FHEMCMS_PreviewLayoutMigration($dir, $plan);
    is($error, undef, 'previews migration');
    my ($backup, $writeError) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    is($writeError, undef, 'commits migration on test copy');
    is_deeply($json->decode(read_bytes($live)), $candidate, 'target matches preview');
    is($candidate->{pages}[0]{widgets}[0]{html}, $source->{pages}[0]{widgets}[0]{html}, 'text and media reference preserved');
    is($candidate->{pages}[0]{widgets}[1]{html}, $source->{pages}[0]{widgets}[1]{html}, 'both HTML placeholder forms preserved');
    is_deeply($candidate->{navigation}{items}, $source->{navigation}{items}, 'navigation items preserved');
    is(read_bytes($mediaPath), $png, 'media bytes remain untouched');
    is(read_bytes(File::Spec->catfile($dir, $backup)), $original, 'backup preserves complete source');
};

subtest 'migration backup verification failure is explicit' => sub {
    my $dir = tempdir(CLEANUP => 1);
    my $original = '{"schemaVersion":4}';
    my ($backup, $error);
    {
        my $read = \&FHEMCMS_ReadFile;
        no warnings 'redefine';
        local *main::FHEMCMS_ReadFile = sub {
            my ($path) = @_;
            return ('different bytes', undef) if ($path =~ /[.]bak\z/);
            return $read->(@_);
        };
        ($backup, $error) = FHEMCMS_CreateMigrationBackup($dir, $original);
    }
    like($error, qr/stimmt nicht/, 'verification failure is reported');
    ok(!defined($backup), 'invalid backup is not returned');
    is_deeply([FHEMCMS_ListBackups($dir)], [], 'invalid backup is removed');
    ($backup, $error) = FHEMCMS_CreateMigrationBackup($dir, $original);
    is($error, undef, 'subsequent verified backup succeeds');
    is(read_bytes(File::Spec->catfile($dir, $backup)), $original, 'verified backup contains original bytes');
    my ($second, $secondError) = FHEMCMS_CreateMigrationBackup($dir, 'other');
    is($secondError, undef, 'second backup succeeds without replacing first');
    isnt($second, $backup, 'backup names are unique');
    is(read_bytes(File::Spec->catfile($dir, $backup)), $original, 'first backup stays unchanged');
};

subtest 'versioned restore accepts and preserves historical schema bytes' => sub {
    my $name = 'HistoricalRestore';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $live = File::Spec->catfile($dir, 'config.json');
    my $original = read_bytes($live);
    for my $version (1 .. 4) {
        my $legacy = {schemaVersion => $version, pages => [{id => 'start', title => 'Original', widgets => []}]};
        my $bytes = $json->pretty->encode($legacy);
        my $backupName = sprintf('config.json.2000010%d-000000.bak', $version);
        write_bytes(File::Spec->catfile($dir, $backupName), $bytes);
        my ($read, $token, $error) = FHEMCMS_PreviewMigrationRestore($dir, $backupName);
        is($error, undef, "schema $version backup validates");
        is($read, $bytes, "schema $version preview preserves bytes");
        my ($newBackup, $commitError) = FHEMCMS_CommitMigrationRestore($dir, $backupName, $token);
        is($commitError, undef, "schema $version restores");
        is(read_bytes($live), $bytes, "schema $version restored without rewriting");
        ok(defined($newBackup), "schema $version creates rollback backup");
    }
    my $draft = File::Spec->catfile($dir, 'draft.json');
    symlink('missing', $draft) or die "Cannot create draft symlink: $!";
    my (undef, undef, $error) = FHEMCMS_PreviewMigrationRestore($dir, 'config.json.20000101-000000.bak');
    like($error, qr/Entwurf/, 'dangling draft symlink blocks restore');
    unlink($draft) or die "Cannot remove draft symlink: $!";
    unlink($live) or die "Cannot remove live file: $!";
    symlink('config.json.20000101-000000.bak', $live) or die "Cannot create live symlink: $!";
    (undef, undef, $error) = FHEMCMS_PreviewMigrationRestore($dir, 'config.json.20000101-000000.bak');
    like($error, qr/Symlinks/, 'live symlink blocks restore');
    unlink($live) or die "Cannot remove live symlink: $!";
    write_bytes($live, $original);
};

subtest 'FHEM migration preview is read-only and validates its request' => sub {
    my $name = 'PreviewAPI';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $live = File::Spec->catfile($dir, 'config.json');
    my $draft = File::Spec->catfile($dir, 'draft.json');
    my $original = read_bytes($live);
    my @backups = FHEMCMS_ListBackups($dir);
    my $plan = {navigation => {col => 1, row => 1, w => 12, h => 1},
        pages => [{id => 'start', widgets => []}]};
    my $payload = encode_base64($json->encode($plan), '');
    my $response = $json->decode(FHEMCMS_Get($hash, $name, 'migrationpreview', $payload));
    is($response->{config}{schemaVersion}, 5, 'returns a candidate via explicit preview API');
    is_deeply($response->{source}, $json->decode($original), 'returns the validated source for stale-preview detection');
    like($response->{token}, qr/\A[0-9a-f]{64}\z/, 'returns bound digest');
    is(read_bytes($live), $original, 'preview does not rewrite live data');
    is_deeply([FHEMCMS_ListBackups($dir)], \@backups, 'preview creates no backup');
    like(FHEMCMS_Get($hash, $name, 'migrationpreview'), qr/Parameter/, 'requires payload');
    like(FHEMCMS_Get($hash, $name, 'migrationpreview', 'not base64!'), qr/Base64/, 'rejects invalid base64');
    like(FHEMCMS_Get($hash, $name, 'migrationpreview', encode_base64('{', '')), qr/JSON/, 'rejects invalid JSON');
    like(FHEMCMS_Get($hash, $name, 'migrationpreview', encode_base64('{}', '')), qr/Migrationsplan/, 'rejects incomplete plan');
    write_bytes($draft, $original);
    like(FHEMCMS_Get($hash, $name, 'migrationpreview', $payload), qr/Entwurf/, 'draft blocks preview API');
    is(read_bytes($draft), $original, 'draft is unchanged');
    is(read_bytes($live), $original, 'failed previews leave live unchanged');
    like(FHEMCMS_Set($hash, $name, 'migrationpreview', $payload), qr/Unknown argument/, 'preview cannot be used as a write command');
};

subtest 'internal version 5 draft contract rejects stale and mixed states' => sub {
    my $name = 'Version5Draft';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $livePath = File::Spec->catfile($dir, 'config.json');
    my $draftPath = File::Spec->catfile($dir, 'draft.json');
    my $tmp = File::Spec->catfile($dir, 'draft.json.v5.tmp');
    my $legacy = read_bytes($livePath);
    my ($state, $error) = FHEMCMS_ReadVersion5State($dir);
    like($error, qr/schemaVersion/, 'legacy state is not accepted by version 5 contract');
    my $plan = {navigation => {col => 1, row => 1, w => 12, h => 1},
        pages => [{id => 'start', widgets => []}]};
    my ($candidate, $previewToken, $previewError) = FHEMCMS_PreviewLayoutMigration($dir, $plan);
    is($previewError, undef, 'previews migration');
    my ($backup, $migrationError) = FHEMCMS_CommitLayoutMigration($dir, $plan, $previewToken);
    is($migrationError, undef, 'migrates isolated device');
    my $liveBytes = read_bytes($livePath);
    ($state, $error) = FHEMCMS_ReadVersion5State($dir);
    is($error, undef, 'reads version 5 state');
    is_deeply($state->{live}, $candidate, 'live is unchanged');
    ok(!defined($state->{draft}), 'initial state has no draft');
    like($state->{token}, qr/\A[0-9a-f]{64}\z/, 'returns state token');
    my $oldToken = $state->{token};
    my $draft = $json->decode($json->encode($candidate));
    $draft->{pages}[0]{title} = 'Draft';
    is(FHEMCMS_WriteVersion5Draft($dir, $draft, $oldToken), undef, 'stores draft');
    is(read_bytes($livePath), $liveBytes, 'draft write leaves live unchanged');
    ($state, $error) = FHEMCMS_ReadVersion5State($dir);
    is($error, undef, 'reads saved draft');
    is_deeply($state->{draft}, $draft, 'draft roundtrips');
    isnt($state->{token}, $oldToken, 'draft changes state token');
    my $draftBytes = read_bytes($draftPath);
    my $next = $json->decode($json->encode($draft));
    $next->{pages}[0]{title} = 'New';
    like(FHEMCMS_WriteVersion5Draft($dir, $next, $oldToken), qr/veraltet/, 'stale client cannot replace draft');
    is(read_bytes($draftPath), $draftBytes, 'stale draft bytes preserved');
    my $bad = $json->decode($json->encode($next));
    $bad->{schemaVersion} = 4;
    like(FHEMCMS_WriteVersion5Draft($dir, $bad, $state->{token}), qr/schemaVersion/, 'mixed format cannot be saved');
    is(read_bytes($draftPath), $draftBytes, 'invalid draft does not replace existing draft');
    write_bytes($tmp, 'foreign');
    like(FHEMCMS_WriteVersion5Draft($dir, $next, $state->{token}), qr/Temporaerer/, 'existing temp file is not replaced');
    is(read_bytes($tmp), 'foreign', 'foreign temp file preserved');
    unlink($tmp) or die "Cannot remove test temporary file: $!";
    {
        my $read = \&FHEMCMS_ReadVersion5State;
        my $count = 0;
        no warnings 'redefine';
        local *main::FHEMCMS_ReadVersion5State = sub {
            $count++;
            write_bytes($draftPath, $legacy) if ($count == 2);
            return $read->(@_);
        };
        like(FHEMCMS_WriteVersion5Draft($dir, $next, $state->{token}), qr/schemaVersion/,
            'late incompatible draft aborts write');
    }
    is(read_bytes($draftPath), $legacy, 'late change preserved');
    ok(!-e $tmp, 'aborted write cleans up own temporary file');
    like(FHEMCMS_Get($hash, $name, 'config'), qr/schemaVersion/, 'legacy read rejects migrated live');
    like(FHEMCMS_Set($hash, $name, 'draft', encode_base64($legacy, '')), qr/schemaVersion/,
        'legacy write rejects migrated live');
    ok(defined($backup), 'original backup remains available');
};

subtest 'internal version 5 publish and discard respect state and backup' => sub {
    my $name = 'Version5Publish';
    my $hash = {NAME => $name};
    is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'defines isolated device');
    my $dir = File::Spec->catdir($modPath, 'fhem-cms-data', $name);
    my $livePath = File::Spec->catfile($dir, 'config.json');
    my $draftPath = File::Spec->catfile($dir, 'draft.json');
    my $tmp = File::Spec->catfile($dir, 'config.json.v5.tmp');
    my $plan = {navigation => {col => 1, row => 1, w => 12, h => 1},
        pages => [{id => 'start', widgets => []}]};
    my ($candidate, $token, $error) = FHEMCMS_PreviewLayoutMigration($dir, $plan);
    is($error, undef, 'prepares version 5');
    my (undef, $migrationError) = FHEMCMS_CommitLayoutMigration($dir, $plan, $token);
    is($migrationError, undef, 'migrates test data');
    my $original = read_bytes($livePath);
    my ($state, $stateError) = FHEMCMS_ReadVersion5State($dir);
    is($stateError, undef, 'reads initial state');
    my (undef, $publishError) = FHEMCMS_PublishVersion5Draft($dir, $state->{token});
    like($publishError, qr/keinen Entwurf/, 'publish requires a draft');
    like(FHEMCMS_DiscardVersion5Draft($dir, $state->{token}), qr/keinen Entwurf/, 'discard requires a draft');
    my $draft = $json->decode($json->encode($candidate));
    $draft->{pages}[0]{title} = 'Version 5 draft';
    is(FHEMCMS_WriteVersion5Draft($dir, $draft, $state->{token}), undef, 'creates draft');
    my $oldToken = $state->{token};
    ($state, $stateError) = FHEMCMS_ReadVersion5State($dir);
    my $draftBytes = read_bytes($draftPath);
    (undef, $publishError) = FHEMCMS_PublishVersion5Draft($dir, $oldToken);
    like($publishError, qr/veraltet/, 'stale publish refused');
    like(FHEMCMS_DiscardVersion5Draft($dir, $oldToken), qr/veraltet/, 'stale discard refused');
    is(read_bytes($livePath), $original, 'stale actions leave live intact');
    is(read_bytes($draftPath), $draftBytes, 'stale actions leave draft intact');
    {
        no warnings 'redefine';
        local *main::FHEMCMS_CreateMigrationBackup = sub { return (undef, 'injected backup failure'); };
        (undef, $publishError) = FHEMCMS_PublishVersion5Draft($dir, $state->{token});
    }
    like($publishError, qr/injected backup failure/, 'backup failure aborts publish');
    ok(!-e $tmp, 'failed publish removes its temporary file');
    is(read_bytes($livePath), $original, 'failed publish preserves live');
    is(read_bytes($draftPath), $draftBytes, 'failed publish preserves draft');
    {
        my $create = \&FHEMCMS_CreateMigrationBackup;
        no warnings 'redefine';
        local *main::FHEMCMS_CreateMigrationBackup = sub {
            my @result = $create->(@_);
            write_bytes($draftPath, $draftBytes . "\n");
            return @result;
        };
        (undef, $publishError) = FHEMCMS_PublishVersion5Draft($dir, $state->{token});
    }
    like($publishError, qr/veraltet/, 'late draft change aborts publish');
    is(read_bytes($livePath), $original, 'late change leaves live intact');
    is(read_bytes($draftPath), $draftBytes . "\n", 'late draft change is preserved');
    ok(!-e $tmp, 'late change cleans temporary file');
    write_bytes($draftPath, $draftBytes);
    my ($backup, $successError) = FHEMCMS_PublishVersion5Draft($dir, $state->{token});
    is($successError, undef, 'publishes verified draft');
    is(read_bytes($livePath), $draftBytes, 'published bytes match draft');
    is(read_bytes(File::Spec->catfile($dir, $backup)), $original, 'backup preserves previous live bytes');
    ok(!-e $draftPath, 'published draft removed');
    ($state, $stateError) = FHEMCMS_ReadVersion5State($dir);
    is_deeply($state->{live}, $draft, 'published data roundtrips');
    is(FHEMCMS_WriteVersion5Draft($dir, $candidate, $state->{token}), undef, 'creates another draft');
    ($state, $stateError) = FHEMCMS_ReadVersion5State($dir);
    is(FHEMCMS_DiscardVersion5Draft($dir, $state->{token}), undef, 'discards confirmed draft');
    ok(!-e $draftPath, 'discard removes draft');
    is(read_bytes($livePath), $draftBytes, 'discard does not touch live');
};

done_testing();
