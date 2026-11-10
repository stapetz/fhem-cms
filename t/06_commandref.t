use strict;
use warnings;
use Test::More;
use FindBin;

open(my $fh, '<', "$FindBin::Bin/../FHEM/01_FHEMCMS.pm") or die $!;
local $/;
my $module = <$fh>;
close($fh) or die $!;
like($module, qr/=begin html_DE\n(.*?)=end html_DE/s, 'embedded German commandref is available');
for my $language ('', '_DE') {
    my ($help) = $module =~ /^=begin html\Q$language\E\n(.*?)^=end html\Q$language\E$/ms;
    ok(defined($help) && length($help), "FHEM help extractor finds language '$language'");
    like($help, qr/<a id="FHEMCMS"><\/a>/, "device help has its module anchor for '$language'");
    like($help, qr/define.*fhemcms/si, "definition is available for '$language'");
}
like($module, qr/help &lt;name&gt; de/, 'default language points to the full German reference');
like($module, qr/^=item summary_DE /m, 'German commandref summary available');
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
