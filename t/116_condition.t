use strict;
use warnings;
use Test::More;
use JSON::PP ();

require './FHEM/01_FHEMCMS.pm';

sub condition {
    my ($operator, $value) = @_;
    return {join => 'and', rules => [{device => 'Sensor', reading => 'state',
        operator => $operator, value => $value}]};
}

for my $operator ('==', '!=', 'contains', 'regex') {
    is(FHEMCMS_ValidateCondition(condition($operator, 'hello')), undef, "$operator accepts text");
}
for my $operator ('<', '<=', '>', '>=') {
    is(FHEMCMS_ValidateCondition(condition($operator, '-1.5e2')), undef, "$operator accepts a finite number");
    like(FHEMCMS_ValidateCondition(condition($operator, '1x')), qr/Numerischer/, "$operator rejects invalid number");
    like(FHEMCMS_ValidateCondition(condition($operator, '1e9999')), qr/Numerischer/, "$operator rejects overflow");
}
for my $pattern ('^a+b?c*$', 'a.b', 'a\\.b', 'a*', '$', '^$', '\\\\$', '') {
    is(FHEMCMS_ValidateCondition(condition('regex', $pattern)), undef, "accepts bounded pattern $pattern");
}
for my $pattern ('(a+)+$', '[ab]', 'a|b', 'a{2}', '\\d', 'a**', 'a\\', 'a' x 129) {
    like(FHEMCMS_ValidateCondition(condition('regex', $pattern)), qr/Ausdruck/, "rejects unsupported pattern $pattern");
}
for my $invalid (
    {join => 'and', rules => []},
    {join => 'and', rules => [], extra => 1},
    {join => 'and', rules => [({device => 'Sensor', reading => 'state', operator => '==', value => 'x'}) x 21]},
    condition('==', "x\n"),
    condition('==', 123),
    condition('==', undef),
) {
    ok(defined(FHEMCMS_ValidateCondition($invalid)), 'rejects malformed condition');
}
my $encoded = unpack('H*', JSON::PP->new->utf8->encode(condition('==', 'on')));
for my $validate (\&FHEMCMS_ValidateHtml, \&FHEMCMS_ValidateFreeHtml) {
    is($validate->("<span data-cms-if=\"$encoded\">on</span><span data-cms-unless=\"$encoded\">off</span>"),
        undef, 'accepts validated condition and alternate');
    ok(defined($validate->('<span data-cms-if="zz">bad</span>')), 'rejects non-hex encoding');
    ok(defined($validate->('<span data-cms-if="7b7d">bad</span>')), 'rejects malformed condition');
    ok(defined($validate->("<p data-cms-if=\"$encoded\">bad</p>")), 'rejects marker on other tags');
    ok(defined($validate->("<span data-cms-if=\"$encoded\" data-cms-unless=\"$encoded\">bad</span>")),
        'rejects conflicting branches');
    ok(defined($validate->("<span data-cms-if=\"$encoded\" onclick=\"alert(1)\">bad</span>")),
        'rejects native event handlers');
}
is(FHEMCMS_ValidateFreeHtml("<div data-cms-if=\"$encoded\"><p>Block</p></div>"), undef,
    'free HTML accepts block condition markers');
ok(defined(FHEMCMS_ValidateHtml("<div data-cms-if=\"$encoded\">Block</div>")),
    'rich text retains its stricter block allowlist');
my $config = {
    schemaVersion => 5, theme => 'dark', settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [{id => 'one', title => 'Eins', widgets => [
        {id => 'one', type => 'text', grid => {col => 1, row => 2, w => 6, h => 2},
            html => "<p><span data-cms-if=\"$encoded\">on</span></p>",
            visibility => {condition => condition('==', 'on'), mode => 'collapse'}},
    ]}],
};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'schema 5 accepts widget and inline conditions');
my $grouped = {join => 'and', rules => [map { +{%{condition('==', 'on')->{rules}[0]}} } 1 .. 3],
    expression => {op => 'or', children => [
        {op => 'and', not => JSON::PP::false, children => [{rule => 0}, {rule => 1}]}, {rule => 2}]}};
my $groupedEncoded = unpack('H*', JSON::PP->new->utf8->encode($grouped));
$config->{pages}[0]{widgets}[0]{visibility}{condition} = $grouped;
$config->{pages}[0]{widgets}[0]{html} = "<span data-cms-if=\"$groupedEncoded\">on</span>";
is(FHEMCMS_ValidateConfig($config, 5), undef, 'schema 5 accepts nested widget and inline conditions');
is(FHEMCMS_ValidateConditionMarkup($groupedEncoded), undef, 'nested condition survives encoded JSON roundtrip');
$config->{pages}[0]{widgets}[0]{visibility}{mode} = 'invalid';
like(FHEMCMS_ValidateConfig($config, 5), qr/Sichtbarkeitsmodus/, 'invalid widget mode rejected');
$config->{pages}[0]{widgets}[0]{visibility}{mode} = 'keep-space';
is(FHEMCMS_ValidateConfig($config, 5), undef, 'keep-space mode accepted');
my $many = condition('==', 'on');
$many->{rules} = [map { +{%{$many->{rules}[0]}} } 1 .. 20];
my $manyEncoded = unpack('H*', JSON::PP->new->utf8->encode($many));
$config->{pages}[0]{widgets}[0]{html} = ('<span data-cms-if="' . $manyEncoded . '">x</span>') x 11;
like(FHEMCMS_ValidateConfig($config, 5), qr/Zu viele Bedingungsregeln/, 'page rule budget enforced');
done_testing();
