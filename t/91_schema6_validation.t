use strict;
use warnings;

use JSON::PP ();
use Test::More;

require './FHEM/01_FHEMCMS.pm';

my $json = JSON::PP->new->canonical;
my $media = 'media/' . ('a' x 32) . '.png';
my $grid = {col => 1, row => 2, w => 4, h => 2};
my $config = {
    schemaVersion => 6,
    settings => {layoutMode => 'grid', gridColumns => 48},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 48, h => 1}},
    pages => [
        {id => 'raster', title => 'Raster', widgets => [{id => 'r1', type => 'text', markdown => 'Grid', grid => $grid}]},
        {id => 'floor', title => 'Grundriss', layoutMode => 'freeform', background => $media,
            canvas => {width => 1280, height => 800, scaling => 'fit', snapGrid => 5, mobileBehavior => 'stack'},
            widgets => [
                {id => 'f1', type => 'text', markdown => 'Freeform', grid => $grid,
                    rect => {x => 0, y => 0, w => 1280, h => 800, z => 9999}},
                {id => 'f2', type => 'text', markdown => 'Overlay', hideOnMobile => JSON::PP::true,
                    rect => {x => 1270, y => 790, w => 10, h => 10}},
            ]},
    ],
};
my $bytes = $json->encode($config);
for my $schema (5, 6) {
    my $kiosk = $json->decode($bytes);
    if ($schema == 5) {
        pop(@{$kiosk->{pages}});
        $kiosk->{schemaVersion} = 5;
    }
    for my $value (JSON::PP::true, JSON::PP::false) {
        $kiosk->{pages}[0]{kiosk} = $value;
        is(FHEMCMS_ValidateConfig($kiosk, $schema), undef, "schema $schema accepts boolean kiosk setting");
    }
    for my $value (1, 'true', undef, {}) {
        $kiosk->{pages}[0]{kiosk} = $value;
        like(FHEMCMS_ValidateConfig($kiosk, $schema), qr/Kioskmodus/, "schema $schema rejects non-boolean kiosk");
    }
}
is(FHEMCMS_ValidateConfig($config, 6), undef, 'mixed pages, allowed overlap and exact canvas-edge placement');
is($json->encode($config), $bytes, 'validation does not rewrite defaults or remembered grid positions');
my $legacy = $json->decode($bytes);
pop(@{$legacy->{pages}});
$legacy->{schemaVersion} = 5;
is(FHEMCMS_ValidateConfig($legacy, 5), undef, 'schema 5 grid without layoutMode remains valid');
$legacy->{settings}{pageCanvas} = {width => 820, height => 1180, mobileBehavior => 'stack'};
$legacy->{settings}{pageNavigationRect} = {x => 20, y => 10, w => 780, h => 60};
is(FHEMCMS_ValidateConfig($legacy, 5), undef, 'grid-only CMS can store common dimensions and navigation');
$legacy->{settings}{pageNavigationRect}{w} = 820;
like(FHEMCMS_ValidateConfig($legacy, 5), qr/Geometrie der Navigation/, 'shared navigation must fit the common canvas');
$legacy->{settings}{pageNavigationRect}{w} = 780;
like(FHEMCMS_ValidateConfig($config, 5), qr/schemaVersion/, 'schema 5 validation refuses schema 6');
$legacy->{pages}[0]{layoutMode} = 'grid';
like(FHEMCMS_ValidateConfig($legacy, 5), qr/layoutMode/, 'schema 5 rejects schema 6 fields');

my $defaults = $json->decode($bytes);
delete @{$defaults->{pages}[1]{canvas}}{qw(scaling snapGrid mobileBehavior)};
$defaults->{pages}[0]{layoutMode} = 'grid';
is(FHEMCMS_ValidateConfig($defaults, 6), undef, 'optional canvas settings and explicit grid are accepted');
$defaults->{pages}[1]{navigationRect} = {x => 1, y => 2, w => 400, h => 48};
is(FHEMCMS_ValidateConfig($defaults, 6), undef, 'page-specific navigation rectangle is accepted');
$defaults->{pages}[1]{navigationRect}{w} = 1280;
like(FHEMCMS_ValidateConfig($defaults, 6), qr/Geometrie der Navigation/, 'navigation rectangle cannot exceed canvas');
delete $defaults->{pages}[1]{navigationRect};
$defaults->{pages}[0]{navigationRect} = {x => 1, y => 2, w => 400, h => 48};
like(FHEMCMS_ValidateConfig($defaults, 6), qr/nur auf Freeform-Seiten/, 'Grid page cannot store a Freeform navigation rectangle');

for my $case (
    ['unknown layout', sub { $_[0]{layoutMode} = 'other' }, qr/Layoutmodus/],
    ['missing canvas', sub { delete $_[0]{canvas} }, qr/canvas/],
    ['canvas below minimum', sub { $_[0]{canvas}{width} = 199 }, qr/canvas\.width/],
    ['canvas above maximum', sub { $_[0]{canvas}{height} = 7681 }, qr/canvas\.height/],
    ['JSON string is not a pixel number', sub { $_[0]{canvas}{width} = '1280' }, qr/canvas\.width/],
    ['invalid scaling', sub { $_[0]{canvas}{scaling} = 'stretch' }, qr/canvas\.scaling/],
    ['invalid snap grid', sub { $_[0]{canvas}{snapGrid} = 2 }, qr/canvas\.snapGrid/],
    ['phase-2 mobile mode', sub { $_[0]{canvas}{mobileBehavior} = 'custom' }, qr/canvas\.mobileBehavior/],
    ['missing rect', sub { delete $_[1]{rect} }, qr/rect/],
    ['negative x', sub { $_[1]{rect}{x} = -1 }, qr/Koordinaten/],
    ['fractional y', sub { $_[1]{rect}{y} = 0.5 }, qr/Koordinaten/],
    ['undersized width', sub { $_[1]{rect}{w} = 9 }, qr/Koordinaten/],
    ['horizontal overflow', sub { $_[1]{rect}{x} = 1 }, qr/Koordinaten/],
    ['vertical overflow', sub { $_[1]{rect}{y} = 1 }, qr/Koordinaten/],
    ['out-of-range layer', sub { $_[1]{rect}{z} = 10000 }, qr/rect\.z/],
    ['numeric boolean', sub { $_[1]{hideOnMobile} = 1 }, qr/hideOnMobile/],
    ['phase-2 mobile rectangle', sub { $_[1]{mobileRect} = {} }, qr/mobileRect/],
    ['invalid remembered grid position', sub { $_[1]{grid}{col} = 0 }, qr/Rasterwerte/],
    ['invalid existing asset format', sub { $_[0]{background} = 'unknown.png' }, qr/Hintergrundbild/],
    ['widget configuration still validated', sub { delete $_[1]{markdown} }, qr/markdown/],
) {
    my ($name, $modify, $error) = @{$case};
    my $candidate = $json->decode($bytes);
    my $page = $candidate->{pages}[1];
    $modify->($page, $page->{widgets}[0]);
    like(FHEMCMS_ValidateConfig($candidate, 6), $error, $name);
}

my $mixed = $json->decode($bytes);
my $shared = $json->decode($bytes);
$shared->{settings}{sharedFreeformSize} = JSON::PP::true;
like(FHEMCMS_ValidateConfig($shared, 6), qr/Freeform-Startseite/, 'sharing requires a Freeform start page');
my $second_freeform = $json->decode($bytes)->{pages}[1];
$second_freeform->{id} = 'another';
unshift @{$shared->{pages}}, $second_freeform;
is(FHEMCMS_ValidateConfig($shared, 6), undef, 'Freeform pages share dimensions without affecting Grid pages');
$second_freeform->{canvas}{width}++;
like(FHEMCMS_ValidateConfig($shared, 6), qr/Startseite entsprechen/, 'mismatched inherited dimensions are rejected');
$mixed->{pages}[0]{widgets}[0]{rect} = {x => 0, y => 0, w => 10, h => 10};
like(FHEMCMS_ValidateConfig($mixed, 6), qr/rect/, 'grid page rejects Freeform widget geometry');
delete $mixed->{pages}[0]{widgets}[0]{rect};
$mixed->{pages}[0]{widgets}[0]{grid}{row} = 1;
like(FHEMCMS_ValidateConfig($mixed, 6), qr/Schema-6-Raster/, 'grid page keeps navigation collision validation');

done_testing();
