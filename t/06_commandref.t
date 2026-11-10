use strict;
use warnings;
use Test::More;
use FindBin;

open(my $fh, '<', "$FindBin::Bin/../FHEM/01_FHEMCMS.pm") or die $!;
local $/;
my $module = <$fh>;
close($fh) or die $!;
like($module, qr/=begin html_DE\n(.*?)=end html_DE/s, 'embedded German commandref is available');
for my $anchor (qw(FHEMCMS FHEMCMSdefine FHEMCMSset FHEMCMSget FHEMCMSattr)) {
    like($module, qr/<a id="\Q$anchor\E"><\/a>/, "$anchor anchor");
}
for my $command (qw(rebuild layoutupgrade purge url status backups media icons layoutformat logreadings history)) {
    like($module, qr/\Q$command\E/, "$command documented");
}
like($module, qr/\?mode=edit/, 'editor entry documented');
like($module, qr/keine Zugriffssperre/, 'editing URL is not described as access control');
like($module, qr/=cut\s*\z/, 'POD block is closed');
done_testing();
