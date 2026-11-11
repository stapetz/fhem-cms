use strict;
use warnings;
use File::Path qw(make_path);
use File::Spec;
use File::Temp qw(tempdir);
use Test::More;

our (%attr, $readingFnAttributes);
sub Log3 { return; }
sub CommandAttr {
    my (undef, $definition) = @_;
    my ($name, $attribute, $value) = split(/\s+/, $definition, 3);
    $attr{$name}{$attribute} = $value;
    return undef;
}
require './FHEM/01_FHEMCMS.pm';

my $root = tempdir(CLEANUP => 1);
make_path(File::Spec->catdir($root, 'www'));
$attr{global}{modpath} = $root;
my $name = 'SetupTest';
my $hash = {NAME => $name};
is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'creates initial device');
my $dir = File::Spec->catdir($root, 'fhem-cms-data', $name);
my ($first, $error) = FHEMCMS_ReadVersion5State($dir);
is($error, undef, 'reads initial state');
like($first->{setupIdentity}, qr/\A[0-9a-f]{64}\z/, 'identity is valid');
is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'ordinary redefinition succeeds');
my ($same) = FHEMCMS_ReadVersion5State($dir);
is($same->{setupIdentity}, $first->{setupIdentity}, 'identity survives ordinary redefinition');
is(FHEMCMS_Set($hash, $name, 'purge', $name), undef, 'purge removes old instance');
is(FHEMCMS_Define($hash, "$name FHEMCMS"), undef, 'recreates same device name');
my ($second, $secondError) = FHEMCMS_ReadVersion5State($dir);
is($secondError, undef, 'reads recreated state');
isnt($second->{setupIdentity}, $first->{setupIdentity}, 'recreated device has a fresh identity');
my $identityPath = File::Spec->catfile($dir, 'setup-identity');
open(my $identity, '>', $identityPath) or die $!;
print {$identity} 'invalid';
close($identity) or die $!;
my (undef, $invalidError) = FHEMCMS_ReadVersion5State($dir);
like($invalidError, qr/Ungueltige Einrichtungskennung/, 'corrupted identity is rejected');
unlink($identityPath) or die $!;
my ($legacy, $legacyError) = FHEMCMS_ReadVersion5State($dir);
is($legacyError, undef, 'existing devices without a marker remain readable');
like($legacy->{setupIdentity}, qr/\A[0-9a-f]{64}\z/, 'legacy state has an identity');
ok(!-e $identityPath, 'reading a legacy device does not create files');
my ($again) = FHEMCMS_ReadVersion5State($dir);
is($again->{setupIdentity}, $legacy->{setupIdentity}, 'legacy identity is stable across reads');
done_testing();
