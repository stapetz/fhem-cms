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
is(FHEMCMS_ValidateConfig($config, 5), undef, 'partial order and hidden groups accepted');
is(FHEMCMS_ValidateBlueprints([{name => 'Car', widget => $widget}]), undef, 'group preferences survive blueprint validation');
$widget->{groupOrder} = [];
$widget->{hiddenGroups} = [];
is(FHEMCMS_ValidateConfig($config, 5), undef, 'empty preferences accepted');
done_testing();
