use strict;
use warnings;
use Test::More;
use JSON::PP ();
require './FHEM/01_FHEMCMS.pm';

my $json = JSON::PP->new->canonical;
my $widget = {id => 'car', type => 'fhem-volvoconnect', device => 'Car',
    showGallery => JSON::PP::true, grid => {col => 1, row => 2, w => 12, h => 18}};
my $config = {schemaVersion => 5, theme => 'liquid-glass',
    settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [{id => 'auto', title => 'Auto', widgets => [$widget]}]};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'accepts VolvoConnect schema 5');
is(FHEMCMS_ValidateBlueprints([{name => 'Car', widget => $widget}]), undef, 'accepts VolvoConnect blueprint');
for my $case (
    ['unsafe device', sub { $_[0]{device} = 'Car;set'; }],
    ['missing device', sub { delete $_[0]{device}; }],
    ['invalid gallery', sub { $_[0]{showGallery} = 'yes'; }],
    ['numeric gallery', sub { $_[0]{showGallery} = 1; }],
    ['invalid popup', sub { $_[0]{showDetails} = 'yes'; }],
    ['numeric popup', sub { $_[0]{showDetails} = 0; }],
    ['manual mapping', sub { $_[0]{readings} = {}; }],
    ['unknown group', sub { $_[0]{groupOrder} = ['unknown']; }],
    ['duplicate group', sub { $_[0]{groupOrder} = ['doors', 'doors']; }],
    ['invalid order container', sub { $_[0]{groupOrder} = {}; }],
    ['null order', sub { $_[0]{groupOrder} = undef; }],
    ['unsafe group', sub { $_[0]{hiddenGroups} = ["doors\n"]; }],
    ['duplicate hidden group', sub { $_[0]{hiddenGroups} = ['state', 'state']; }],
    ['invalid hidden container', sub { $_[0]{hiddenGroups} = 'state'; }],
    ['too many groups', sub { $_[0]{groupOrder} = [('state') x 16]; }],
    ['gallery hidden separately', sub { $_[0]{hiddenGroups} = ['gallery']; }],
    ['duplicate gallery', sub { $_[0]{groupOrder} = ['gallery','gallery']; }],
    ['null hidden readings', sub { $_[0]{hiddenReadings} = undef; }],
    ['non-list hidden readings', sub { $_[0]{hiddenReadings} = {}; }],
    ['unsafe hidden reading', sub { $_[0]{hiddenReadings} = ["state_x\n"]; }],
    ['non-group reading', sub { $_[0]{hiddenReadings} = ['password']; }],
    ['duplicate hidden reading', sub { $_[0]{hiddenReadings} = ['state_x','state_x']; }],
    ['too many hidden readings', sub { $_[0]{hiddenReadings} = [('state_x') x 1001]; }],
    ['null card sizes', sub { $_[0]{cardSizes} = undef; }],
    ['array card sizes', sub { $_[0]{cardSizes} = []; }],
    ['unknown sized card', sub { $_[0]{cardSizes} = {unknown => {w=>4,h=>8}}; }],
    ['invalid sized card', sub { $_[0]{cardSizes} = {state => []}; }],
    ['too narrow card', sub { $_[0]{cardSizes} = {state => {w=>2,h=>8}}; }],
    ['too wide card', sub { $_[0]{cardSizes} = {state => {w=>13,h=>8}}; }],
    ['too short card', sub { $_[0]{cardSizes} = {state => {w=>4,h=>3}}; }],
    ['too high card', sub { $_[0]{cardSizes} = {state => {w=>4,h=>65}}; }],
    ['fractional card', sub { $_[0]{cardSizes} = {state => {w=>3.5,h=>8}}; }],
    ['boolean card size', sub { $_[0]{cardSizes} = {state => {w=>JSON::PP::true,h=>8}}; }],
    ['extra card field', sub { $_[0]{cardSizes} = {state => {w=>4,h=>8,x=>0}}; }],
    ['missing card height', sub { $_[0]{cardSizes} = {state => {w=>4}}; }],
    ['null card grid', sub { $_[0]{cardGrid} = undef; }],
    ['invalid card grid columns', sub { $_[0]{cardGrid} = {columns=>13,rowHeight=>16}; }],
    ['zero card row height', sub { $_[0]{cardGrid} = {columns=>96,rowHeight=>0}; }],
    ['boolean card row height', sub { $_[0]{cardGrid} = {columns=>96,rowHeight=>JSON::PP::true}; }],
    ['extra card grid property', sub { $_[0]{cardGrid} = {columns=>96,rowHeight=>16,x=>1}; }],
    ['wide inherited card', sub { $_[0]{cardGrid} = {columns=>96,rowHeight=>16}; $_[0]{cardSizes}={state=>{w=>97,h=>20}}; }],
    ['high inherited card', sub { $_[0]{cardGrid} = {columns=>96,rowHeight=>16}; $_[0]{cardSizes}={state=>{w=>96,h=>1001}}; }],
) {
    my ($label, $change) = @{$case};
    my $copy = $json->decode($json->encode($config));
    $change->($copy->{pages}[0]{widgets}[0]);
    ok(defined(FHEMCMS_ValidateConfig($copy, 5)), "rejects $label");
}
delete $widget->{showGallery};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'gallery defaults on when flag omitted');
$widget->{showGallery} = JSON::PP::false;
is(FHEMCMS_ValidateConfig($config, 5), undef, 'gallery may be disabled');
$widget->{showDetails} = JSON::PP::false;
is(FHEMCMS_ValidateConfig($config, 5), undef, 'full inline detail display accepted');
is(FHEMCMS_ValidateBlueprints([{name => 'Inline car', widget => $widget}]), undef, 'inline flag survives blueprint validation');
$widget->{showDetails} = JSON::PP::true;
is(FHEMCMS_ValidateConfig($config, 5), undef, 'compact popup display accepted');
$widget->{groupOrder} = ['location', 'gallery', 'doors'];
$widget->{hiddenGroups} = ['state', 'statistics'];
$widget->{hiddenReadings} = ['state_batteryChargeLevel','vehicle_vin','lastUpdate'];
$widget->{cardSizes} = {state=>{w=>6,h=>10},gallery=>{w=>12,h=>8}};
is(FHEMCMS_ValidateConfig($config, 5), undef, 'partial order and hidden groups accepted');
is(FHEMCMS_ValidateBlueprints([{name => 'Car', widget => $widget}]), undef, 'group preferences survive blueprint validation');
$widget->{groupOrder} = [];
$widget->{hiddenGroups} = [];
is(FHEMCMS_ValidateConfig($config, 5), undef, 'empty preferences accepted');
for my $columns (12,24,48,96,192) {
    $widget->{cardGrid} = {columns=>$columns,rowHeight=>1553 / $columns};
    $widget->{cardSizes} = {state=>{w=>$columns,h=>40},doors=>{w=>1,h=>1}};
    is(FHEMCMS_ValidateConfig($config, 5), undef, "accepts inherited $columns-column card grid");
    is(FHEMCMS_ValidateBlueprints([{name=>'Grid',widget=>$widget}]), undef, "blueprint preserves inherited $columns-column grid");
}
done_testing();
