use strict;
use warnings;
use Test::More;
use JSON::PP ();
require './FHEM/01_FHEMCMS.pm';

my $json = JSON::PP->new->canonical;
my $widget = {
    id => 'energy', type => 'fhem-solar-energy',
    readings => {pv => {device => 'PV', reading => 'power'}, soc => {device => 'Battery', reading => 'soc'}},
    sections => [{label => 'Roof', readings => {day => {device => 'Meter', reading => 'today'}}}],
    powerUnit => 'W', energyUnit => 'kWh', threshold => 10, deriveHome => JSON::PP::true,
    grid => {col => 1, row => 2, w => 12, h => 10},
};
my $config = {
    schemaVersion => 5, theme => 'liquid-glass',
    settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [{id => 'start', title => 'Start', widgets => [$widget]}],
};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'accepts cross-device solar energy widget');
is(FHEMCMS_ValidateBlueprints([{name => 'Solar', widget => $widget}]), undef, 'solar energy supports server-side blueprints');
for my $case (
    ['missing PV', sub { delete $_[0]{readings}{pv}; }],
    ['unsafe device', sub { $_[0]{readings}{pv}{device} = 'PV;set'; }],
    ['unsafe reading', sub { $_[0]{readings}{pv}{reading} = "bad\nreading"; }],
    ['unknown source field', sub { $_[0]{readings}{pv}{extra} = 1; }],
    ['unknown reading', sub { $_[0]{readings}{unknown} = {device => 'PV', reading => 'power'}; }],
    ['empty yield', sub { $_[0]{sections}[0]{readings} = {}; }],
    ['blank label', sub { $_[0]{sections}[0]{label} = ' '; }],
    ['long label', sub { $_[0]{sections}[0]{label} = 'x' x 65; }],
    ['control label', sub { $_[0]{sections}[0]{label} = "bad\x01"; }],
    ['too many sections', sub { $_[0]{sections} = [map { {label => 'Roof', readings => {day => {device => 'PV', reading => 'day'}}} } 1..9]; }],
    ['bad energy unit', sub { $_[0]{energyUnit} = 'MW'; }],
    ['bad power unit', sub { $_[0]{powerUnit} = 'Wh'; }],
    ['negative threshold', sub { $_[0]{threshold} = -1; }],
    ['fractional threshold', sub { $_[0]{threshold} = 2.5; }],
    ['invalid derive flag', sub { $_[0]{deriveHome} = 'yes'; }],
    ['unknown section field', sub { $_[0]{sections}[0]{extra} = 1; }],
) {
    my ($label, $change) = @{$case};
    my $copy = $json->decode($json->encode($config));
    $change->($copy->{pages}[0]{widgets}[0]);
    ok(defined(FHEMCMS_ValidateConfig($copy, 5)), "rejects $label");
}
my $copy = $json->decode($json->encode($config));
$copy->{pages}[0]{widgets}[0]{sections} = [map {
    my $i = $_;
    {label => "Part$i", readings => {map {$_ => {device => "D$i$_", reading => 'value'}} qw(total hour day month previousMonth year)}}
} 1..4];
like(FHEMCMS_ValidateConfig($copy, 5), qr/hoechstens 20/, 'caps distinct device subscriptions');
done_testing();
