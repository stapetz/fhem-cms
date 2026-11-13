use strict;
use warnings;

use Digest::SHA qw(sha256_hex);
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use JSON::PP ();
use MIME::Base64 qw(encode_base64);
use Test::More;

our %attr;
sub Log3 { return; }

require './FHEM/01_FHEMCMS.pm';

my $modPath = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($modPath, 'www'));
$attr{global}{modpath} = $modPath;

my ($dirError, $dataDir, $created) = FHEMCMS_CreateDataDir('CMS');
is($dirError, undef, 'creates the per-CMS data directory');
is(FHEMCMS_EnsureConfig('CMS', $dataDir, $created), undef, 'creates a valid CMS configuration');

my $json = JSON::PP->new->utf8->canonical;
my $initial = $json->decode(FHEMCMS_Get({NAME => 'CMS'}, 'CMS', 'version5blueprints'));
is_deeply($initial->{items}, [], 'new CMS devices start with an empty blueprint list');
is($initial->{token}, sha256_hex(''), 'empty blueprint list has a stable initial token');

my $widget = {
    id => 'text',
    type => 'text',
    title => 'Status',
    markdown => '{{Temp:state}}',
    grid => {col => 1, row => 2, w => 4, h => 2},
};
my $items = [{name => 'Statusanzeige', widget => $widget}];
my $payload = encode_base64($json->encode($items), '');
my $saved = FHEMCMS_Set({NAME => 'CMS'}, 'CMS', 'version5blueprints', $initial->{token}, $payload);
my $savedResult = $json->decode($saved);
like($savedResult->{token}, qr/\A[0-9a-f]{64}\z/, 'saving returns a content token');

my $reloaded = $json->decode(FHEMCMS_Get({NAME => 'CMS'}, 'CMS', 'version5blueprints'));
is_deeply($reloaded->{items}, $items, 'blueprints persist on the FHEM server');
is($reloaded->{token}, $savedResult->{token}, 'read confirms the stored revision');

like(FHEMCMS_Set({NAME => 'CMS'}, 'CMS', 'version5blueprints', $initial->{token}, $payload),
    qr/zwischenzeitlich geändert/, 'stale blueprint writes are rejected');
for my $invalid (
    [{name => 'Doppelt', widget => $widget}, {name => 'Doppelt', widget => $widget}],
    [{name => 'Ungültig', widget => {%{$widget}, unsupported => 1}}],
    [{name => 'Pfad', widget => {%{$widget}, id => '../widget'}}],
) {
    my $badPayload = encode_base64($json->encode($invalid), '');
    like(FHEMCMS_Set({NAME => 'CMS'}, 'CMS', 'version5blueprints', $reloaded->{token}, $badPayload),
        qr/(?:doppelt|Ungueltig|ungueltig)/i, 'invalid blueprint data is rejected');
}

my ($otherError, $otherDir) = FHEMCMS_CreateDataDir('OtherCMS');
is($otherError, undef, 'creates another CMS data directory');
my $other = $json->decode(FHEMCMS_Get({NAME => 'OtherCMS'}, 'OtherCMS', 'version5blueprints'));
is_deeply($other->{items}, [], 'blueprints remain isolated to their CMS device');

done_testing();
