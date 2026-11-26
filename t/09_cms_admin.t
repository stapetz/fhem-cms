use strict;
use warnings;
use File::Path qw(make_path remove_tree);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use Test::More;

our (%attr, %defs, %data, %FW_webArgs, @FW_httpheader, $FW_chash, $FW_wname, %FHEMCMS_PURGED);
my %denied;
my @deleted;
my @logs;
my $deleteFailure;
my $deleteSuccess = '';
sub Authorized { my (undef, $type, $value) = @_; return !$denied{"$type:$value"}; }
sub CommandAttr { return undef; }
sub CommandDelete {
    my (undef, $name) = @_;
    return $deleteFailure if (defined($deleteFailure));
    push(@deleted, $name);
    delete($defs{$name});
    return $deleteSuccess;
}
sub Log3 { push(@logs, [@_]); }
require './FHEM/01_FHEMCMS.pm';

my $root = tempdir(CLEANUP => 1);
make_path("$root/www/fhem-cms/js", "$root/www/fhem-cms/css");
$attr{global}{modpath} = $root;
$FW_wname = 'WEB';
$FW_chash = {NAME => 'WEBclient'};
$defs{WEB} = {TYPE => 'FHEMWEB', CSRFTOKEN => 'test-token'};
FHEMCMS_Initialize({});
is($data{FWEXT}{'/fhemcms-admin'}{FUNC}, 'FHEMCMS_AdminEndpoint', 'global endpoint registered');

sub create_cms {
    my ($name) = @_;
    $defs{$name} = {NAME => $name, TYPE => 'FHEMCMS', NR => scalar(keys %defs)};
    is(FHEMCMS_Define($defs{$name}, "$name FHEMCMS"), undef, "create $name");
}
sub inventory {
    my ($value, $error) = FHEMCMS_AdminInventory();
    is($error, undef, 'inventory succeeds');
    return $value;
}
sub item { my ($value, $name) = @_; return (grep { $_->{name} eq $name } @{$value->{items}})[0]; }
sub execute {
    my ($value, @names) = @_;
    return FHEMCMS_AdminExecute({token => $value->{token}, confirmation => 'DELETE',
        items => [map { {name => $_, kind => item($value, $_)->{kind}} } @names]});
}
create_cms('Keep');
for my $setting (undef, '0', '1') {
    if (defined($setting)) { $attr{Keep}{adminMenu} = $setting; }
    else { delete($attr{Keep}{adminMenu}); }
    my $settings = JSON::PP->new->decode(FHEMCMS_Get($defs{Keep}, 'Keep', 'layoutformat'));
    is($settings->{adminMenuEnabled} ? 1 : 0, defined($setting) && $setting eq '1' ? 1 : 0,
        'admin menu requires explicit device attribute');
}
delete($attr{Keep}{adminMenu});
like(FHEMCMS_Attr('set', 'Keep', 'adminMenu', 'yes'), qr/0 oder 1/, 'invalid menu attribute rejected');
is(FHEMCMS_Attr('set', 'Keep', 'adminMenu', '1'), undef, 'explicit menu enable accepted');
is(FHEMCMS_Attr('del', 'Keep', 'adminMenu', undef), undef, 'menu attribute removal accepted');
create_cms('Remove');
create_cms('Orphan');
delete($defs{Orphan});
create_cms('DataOnly');
delete($defs{DataOnly});
remove_tree("$root/www/fhem-cms/DataOnly");
make_path("$root/www/fhem-cms/Foreign");
open(my $foreign, '>', "$root/www/fhem-cms/Foreign/personal.txt") or die $!;
print {$foreign} 'keep'; close($foreign);
my $outside = tempdir(CLEANUP => 1);
symlink($outside, "$root/fhem-cms-data/Linked") or die $!;
my $value = inventory();
is(item($value, 'Keep')->{kind}, 'device', 'active device listed');
is(item($value, 'Orphan')->{kind}, 'orphan', 'deleted device retained files listed');
is(item($value, 'DataOnly')->{blocked}, undef, 'schema 5 data-only orphan recognized');
ok(item($value, 'Foreign')->{blocked}, 'unowned folder blocked');
ok(item($value, 'Linked')->{blocked}, 'symlink blocked');
ok(!item($value, 'js') && !item($value, 'css'), 'shared assets excluded');
ok(grep({ $_->{path} eq 'fhem-cms-data/Keep/config.json' } @{item($value, 'Keep')->{files}}),
    'file structure includes private config path without exposing contents');
like(execute($value, 'Foreign')->{error}, qr/Keine eindeutig/, 'foreign directory deletion refused');
ok(-f "$root/www/fhem-cms/Foreign/personal.txt", 'foreign files preserved');

$denied{'devicename:Keep'} = 1;
ok(!item(inventory(), 'Keep'), 'unauthorized devices hidden');
delete($denied{'devicename:Keep'});
$denied{'cmd:delete'} = 1;
ok(item(inventory(), 'Keep')->{blocked}, 'read-only clients cannot delete');
delete($denied{'cmd:delete'});
$denied{'cmd:get'} = 1;
my (undef, $error) = FHEMCMS_AdminInventory();
like($error, qr/Zugriff verweigert/, 'inventory requires get permission');
delete($denied{'cmd:get'});

$value = inventory();
create_cms('Later');
like(execute($value, 'Remove')->{error}, qr/veraltet/, 'stale inventory rejects deletion');
$value = inventory();
$defs{Remove}{NR}++;
like(execute($value, 'Remove')->{error}, qr/veraltet/, 'recreated device identity invalidates selection');
my $result = execute(inventory(), 'Remove', 'Orphan', 'DataOnly');
is(scalar(@{$result->{results}}), 3, 'batch reports every result');
ok(!grep({ !$_->{ok} } @{$result->{results}}), 'selected device and orphans removed');
is($result->{results}[0]{message}, 'Purge und Delete abgeschlossen',
    'empty CommandDelete success return produces explicit success message');
is_deeply(\@deleted, ['Remove'], 'only selected active device passed to CommandDelete');
ok(-d "$root/fhem-cms-data/Keep", 'unselected data preserved');
ok(!-e "$root/fhem-cms-data/Orphan" && !-e "$root/www/fhem-cms/Remove", 'selected file structures removed');
ok(-d "$root/www/fhem-cms/js" && -d $outside, 'shared and external roots preserved');

{
    $deleteSuccess = undef;
    create_cms('UndefinedDeleteSuccess');
    $result = execute(inventory(), 'UndefinedDeleteSuccess');
    ok($result->{results}[0]{ok}, 'undefined CommandDelete success return remains accepted');
    $deleteSuccess = '';
}

create_cms('FailDuringPurge');
create_cms('BatchSuccess');
{
    no warnings 'redefine';
    my $purge = \&FHEMCMS_Purge;
    local *FHEMCMS_Purge = sub {
        my ($name, $checkOnly) = @_;
        return 'Injected purge failure' if ($name eq 'FailDuringPurge' && !$checkOnly);
        return $purge->(@_);
    };
    $result = execute(inventory(), 'FailDuringPurge', 'BatchSuccess');
    ok(!$result->{results}[0]{ok} && $result->{results}[1]{ok}, 'batch reports partial failures explicitly');
    ok($defs{FailDuringPurge} && !grep({ $_ eq 'FailDuringPurge' } @deleted),
        'runtime purge failure never calls delete');
    ok(-d "$root/fhem-cms-data/FailDuringPurge", 'failed purge leaves test data intact');
}

create_cms('RefusePurge');
open(my $extra, '>', "$root/www/fhem-cms/RefusePurge/foreign.txt") or die $!;
print {$extra} 'keep'; close($extra);
$result = execute(inventory(), 'RefusePurge');
ok($result->{error}, 'preflight refuses foreign files before deleting');
ok($defs{RefusePurge}, 'purge refusal retains device');
create_cms('RefuseDelete');
$deleteFailure = 'delete denied by FHEM';
$result = execute(inventory(), 'RefuseDelete');
ok(!$result->{results}[0]{ok}, 'delete failure reported');
is($result->{results}[0]{message}, $deleteFailure, 'delete error visible');
ok($defs{RefuseDelete} && $FHEMCMS_PURGED{RefuseDelete}, 'purged but undeleted device remains explicit');
undef($deleteFailure);

%FW_webArgs = (op => 'delete', fwcsrf => 'wrong', payload => '{}');
@FW_httpheader = ('POST /fhem/fhemcms-admin?op=delete HTTP/1.1');
my (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=delete');
like(JSON::PP->new->decode($body)->{error}, qr/CSRF/, 'CSRF required on extension writes');
$FW_webArgs{fwcsrf} = 'test-token';
@FW_httpheader = ('GET /fhem/fhemcms-admin?op=delete HTTP/1.1');
(undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=delete');
like(JSON::PP->new->decode($body)->{error}, qr/POST/, 'GET cannot delete');
@FW_httpheader = ('POST /fhem/fhemcms-admin?op=delete HTTP/1.1');
$FW_webArgs{payload} = '{bad';
(undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=delete');
is(JSON::PP->new->decode($body)->{error}, 'Ungueltiges Verwaltungs-JSON', 'malformed JSON rejected');
$value = inventory();
$FW_webArgs{payload} = JSON::PP->new->encode({token => $value->{token}, confirmation => 'DELETE',
    items => [{name => 'Later', kind => 'device'}]});
(undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=delete');
ok(JSON::PP->new->decode($body)->{results}[0]{ok}, 'authenticated POST dispatches real deletion');
delete($defs{WEB}{CSRFTOKEN});
delete($FW_webArgs{fwcsrf});
$FW_webArgs{payload} = '{}';
(undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=delete');
like(JSON::PP->new->decode($body)->{error}, qr/CSRF/, 'missing token alone does not disable server validation');
$attr{WEB}{csrfToken} = 'none';
@FW_httpheader = ('GET /fhem/fhemcms-admin?op=delete HTTP/1.1');
(undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=delete');
like(JSON::PP->new->decode($body)->{error}, qr/POST/, 'disabled CSRF still requires POST');
@FW_httpheader = ('POST /fhem/fhemcms-admin?op=delete HTTP/1.1');
create_cms('NoCsrf');
$value = inventory();
$FW_webArgs{payload} = JSON::PP->new->encode({token => $value->{token}, confirmation => 'DELETE',
    items => [{name => 'NoCsrf', kind => 'device'}]});
(undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=delete');
ok(JSON::PP->new->decode($body)->{results}[0]{ok}, 'explicit csrfToken none permits confirmed deletion without token');
ok(!$defs{NoCsrf} && !-d "$root/fhem-cms-data/NoCsrf", 'disabled-CSRF deletion actually purges and deletes test CMS');
delete($attr{WEB}{csrfToken});
{
    no warnings 'redefine';
    my $starts = 0;
    $defs{WEB}{CSRFTOKEN} = 'test-token';
    local *main::FHEMCMS_LogIndexStart = sub { $starts++; return undef; };
    %FW_webArgs = (op => 'cache-rebuild', fwcsrf => 'wrong');
    @FW_httpheader = ('POST /fhem/fhemcms-admin HTTP/1.1');
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-rebuild');
    like(JSON::PP::decode_json($body)->{error}, qr/CSRF/, 'cache rebuild requires CSRF');
    $FW_webArgs{fwcsrf} = 'test-token';
    @FW_httpheader = ('GET /fhem/fhemcms-admin HTTP/1.1');
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-rebuild');
    like(JSON::PP::decode_json($body)->{error}, qr/POST/, 'cache rebuild requires POST');
    @FW_httpheader = ('POST /fhem/fhemcms-admin HTTP/1.1');
    $denied{'cmd:set'} = 1;
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-rebuild');
    like(JSON::PP::decode_json($body)->{error}, qr/Zugriff verweigert/, 'cache rebuild requires set permission');
    is($starts, 0, 'denied requests cannot start cache build');
    delete($denied{'cmd:set'});
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-rebuild');
    is(JSON::PP::decode_json($body)->{status}, 'pending', 'authorized request starts cache build');
    is($starts, 1, 'authorized request starts exactly one build');
    $denied{'cmd:get'} = 1;
    %FW_webArgs = (op => 'cache-status');
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-status');
    like(JSON::PP::decode_json($body)->{error}, qr/Zugriff verweigert/, 'cache status requires get permission');
    delete($denied{'cmd:get'});
}
{
    no warnings 'redefine';
    my $argument;
    local *main::BlockingCall = sub { $argument = $_[1]; return {pid => 123}; };
    local $defs{Alpha} = {NAME => 'Alpha', TYPE => 'dummy'};
    local $defs{Beta} = {NAME => 'Beta', TYPE => 'dummy'};
    local $attr{Alpha}{alias} = 'Garage <Nord>';
    my $cache = {version => 1, builtAt => CORE::time(),
        fingerprint => FHEMCMS_LogIndexFingerprint(),
        sources => {dblog => {Database => {Alpha => {power => 1}, Beta => {state => 1}}},
            filelog => {Files => {Alpha => {energy => 1, power => 1}}}},
        errors => {dblog => {}, filelog => {}}};
    is(FHEMCMS_LogIndexWrite("$root/fhem-cms-data", $cache), undef, 'prepares shared cache contents');
    %FW_webArgs = (op => 'cache-contents', offset => 0);
    $denied{'cmd:get'} = 1;
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-contents');
    like(JSON::PP::decode_json($body)->{error}, qr/Zugriff/, 'cache contents require get permission');
    delete($denied{'cmd:get'});
    $denied{'devicename:Beta'} = 1;
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-contents');
    is(JSON::PP::decode_json($body)->{status}, 'pending', 'cache contents are read asynchronously');
    FHEMCMS_HistoryDone(FHEMCMS_HistoryWorker($argument));
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-contents');
    my $contents = JSON::PP::decode_json($body);
    is_deeply($contents->{items}, [{name => 'Alpha', alias => 'Garage <Nord>',
        readings => [qw(energy power)]}], 'contents merge sources, include alias and filter forbidden devices');
    delete($denied{'devicename:Beta'});
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-contents');
    is(JSON::PP::decode_json($body)->{status}, 'pending', 'different permissions use a separate result');
    FHEMCMS_HistoryDone(FHEMCMS_HistoryWorker($argument));
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-contents');
    $contents = JSON::PP::decode_json($body);
    is_deeply([map { $_->{name} } @{$contents->{items}}], [qw(Alpha Beta)], 'devices are sorted by name');
    my $large = {version => 1, builtAt => CORE::time(),
        sources => {dblog => {Database => {map { sprintf('Sensor%03d', $_) => {state => 1} } 1 .. 55}},
            filelog => {}}, errors => {dblog => {}, filelog => {}}};
    my @sensors = sort keys %{$large->{sources}{dblog}{Database}};
    is(FHEMCMS_LogIndexWrite("$root/fhem-cms-data", $large), undef, 'prepares more than one page');
    my $page = JSON::PP::decode_json(FHEMCMS_LogIndexContents(\@sensors, 50));
    is($page->{total}, 55, 'page reports total device count');
    is_deeply([map { $_->{name} } @{$page->{items}}], [@sensors[50 .. 54]],
        'second page contains the remaining sorted devices');
    $page = JSON::PP::decode_json(FHEMCMS_LogIndexContents(\@sensors, 100));
    is_deeply($page->{items}, [], 'page past the end is empty without failure');
    %FW_webArgs = (op => 'cache-contents', offset => '../');
    (undef, $body) = FHEMCMS_AdminEndpoint('/fhemcms-admin?op=cache-contents');
    like(JSON::PP::decode_json($body)->{error}, qr/Cache-Seite/, 'invalid page is rejected');
}
like(FHEMCMS_Purge('../'), qr/Ungueltiger/, 'purge validates names at core boundary');
delete($defs{$_}) for grep { ($defs{$_}{TYPE} // '') eq 'FHEMCMS' } keys %defs;
$value = inventory();
ok(!grep({ $_->{kind} eq 'device' } @{$value->{items}}), 'inventory works without remaining CMS devices');
ok(item($value, 'Keep'), 'orphan discovery still works after last device deletion');
ok(@logs, 'administration actions logged');
done_testing();
