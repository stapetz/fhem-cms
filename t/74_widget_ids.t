use strict;
use warnings;
use Test::More;
use File::Temp qw(tempdir);
use File::Spec;
use JSON::PP;

require './FHEM/01_FHEMCMS.pm';
my $dir = tempdir(CLEANUP => 1);
my $config = {
    schemaVersion => 5, theme => 'dark', settings => {layoutMode => 'grid', gridColumns => 12},
    navigation => {orientation => 'horizontal', grid => {col => 1, row => 1, w => 12, h => 1}},
    pages => [map { {id => $_, title => $_, widgets => [
        {id => 'w1', type => 'text', html => $_, grid => {col => 1, row => 2, w => 4, h => 2}},
    ]} } qw(one two)],
};
sub write_json {
    my ($name, $value) = @_;
    open(my $out, '>:raw', File::Spec->catfile($dir, $name)) or die $!;
    print {$out} JSON::PP->new->utf8->encode($value);
    close($out) or die $!;
}
write_json('config.json', $config);
my ($state, $error) = FHEMCMS_ReadVersion5State($dir);
is($error, undef, 'legacy duplicate IDs remain readable without writes');
is($state->{live}{pages}[1]{widgets}[0]{id}, 'w1', 'reading does not change live IDs');
is(FHEMCMS_WriteVersion5Draft($dir, $config, $state->{token}), undef, 'draft write normalizes duplicate IDs');
($state, $error) = FHEMCMS_ReadVersion5State($dir);
is($state->{draft}{pages}[1]{widgets}[0]{id}, 'w1-2', 'persisted draft has global IDs');
is($state->{live}{pages}[1]{widgets}[0]{id}, 'w1', 'live untouched until publish');
my ($backup, $publish_error) = FHEMCMS_PublishVersion5Draft($dir, $state->{token});
is($publish_error, undef, 'normalized draft publishes');
ok($backup, 'publish backs up previous live configuration');
($state, $error) = FHEMCMS_ReadVersion5State($dir);
is($state->{live}{pages}[1]{widgets}[0]{id}, 'w1-2', 'global IDs survive reload and publish');
write_json('draft.json', $config);
($state, $error) = FHEMCMS_ReadVersion5State($dir);
($backup, $publish_error) = FHEMCMS_PublishVersion5Draft($dir, $state->{token});
is($publish_error, undef, 'legacy draft with duplicates can publish safely too');
($state, $error) = FHEMCMS_ReadVersion5State($dir);
is($state->{live}{pages}[1]{widgets}[0]{id}, 'w1-2', 'legacy draft normalized before publishing');
is($config->{pages}[1]{widgets}[0]{id}, 'w1', 'normalization does not mutate caller input');
done_testing();
