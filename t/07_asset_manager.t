use strict;
use warnings;
use Test::More;
use File::Temp qw(tempdir);
use File::Path qw(make_path);
use File::Spec;
use JSON::PP ();
use MIME::Base64 qw(encode_base64);
our (%attr, %defs, %data, $FW_chash, $FW_headerlines, $FW_httpRetCode, %FHEMCMS_ASSET_UPLOADS);
my (@logs, @timers, @buffers);
sub Log3 { push(@logs, [@_]); }
sub InternalTimer { push(@timers, [@_]); }
sub RemoveInternalTimer {}
my $authorized = 1;
sub Authorized { return $authorized; }
sub FW_addToWritebuffer { push(@buffers, $_[1]); $_[0]{callback} = $_[2]; return 1; }
sub TcpServer_Close { delete($_[0]{FD}); }
require './FHEM/01_FHEMCMS.pm';
my $json = JSON::PP->new->utf8->canonical;
my $root = tempdir(CLEANUP => 1);
$attr{global}{modpath} = $root;
make_path("$root/fhem-cms-data/CMS", "$root/www/fhem-cms/CMS/media");
my $dir = "$root/fhem-cms-data/CMS";
my $config = { schemaVersion => 5, theme => 'dark', settings => { layoutMode => 'grid', gridColumns => 12 },
    navigation => { orientation => 'horizontal', grid => { col => 1, row => 1, w => 12, h => 1 } },
    pages => [{ id => 'start', title => 'Start', widgets => [] }] };
sub write_bytes {
    my ($path, $bytes) = @_;
    open(my $fh, '>:raw', $path) or die $!;
    print {$fh} $bytes or die $!;
    close($fh) or die $!;
}
write_bytes("$dir/config.json", $json->encode($config));
my $initial = $json->encode($config);
my $call = sub { $json->decode(FHEMCMS_AssetsDispatch('CMS', $_[0])); };
my $state = $call->({op => 'list'});
is($state->{policy}{imageBytes}, 3145728, 'image default 3 MiB');
is($state->{policy}{documentBytes}, 20971520, 'document default 20 MiB');
is($state->{policy}{totalBytes}, 524288000, 'total default 500 MiB');
ok($state->{policy}{types}{$_}, "$_ enabled by default") for qw(pdf doc docx xls xlsx ppt pptx odt ods odp txt csv png jpg jpeg gif);
my $change = sub {
    my (%request) = @_;
    my $reply = $call->({%request, token => $state->{token}});
    $state = $reply->{state} if ($reply->{state});
    return $reply;
};
my $upload = sub {
    my ($name, $bytes, $folder) = @_;
    my $begin = $change->(op => 'begin', name => $name, size => length($bytes), folder => $folder // 'root');
    return $begin if ($begin->{error});
    for (my $offset = 0; $offset < length($bytes); $offset += 65536) {
        my $reply = $call->({ op => 'chunk', upload => $begin->{upload}, offset => $offset,
            data => encode_base64(substr($bytes, $offset, 65536), '') });
        die $reply->{error} if ($reply->{error});
        is($reply->{received}, $offset + length(substr($bytes, $offset, 65536)), 'bounded upload chunk confirmed');
    }
    my $finish = $change->(op => 'finish', upload => $begin->{upload});
    $call->({op => 'cancel', upload => $begin->{upload}}) if ($finish->{error});
    return $finish;
};
my $oldToken = $state->{token};
my $reply = $change->(op => 'mkdir', name => 'Bilder', parent => 'root');
ok(!$reply->{error}, 'create folder');
my $folder = $state->{folders}[0]{id};
$reply = $change->(op => 'mkdir', name => 'Solar', parent => $folder);
ok(!$reply->{error}, 'create nested folder');
my $subfolder = $state->{folders}[1]{id};
like($call->({op => 'mkdir', token => $oldToken, name => 'stale', parent => 'root'})->{error}, qr/geaendert/, 'stale catalog rejected');
like($change->(op => 'folder', id => $folder, name => 'Bilder', parent => $subfolder)->{error}, qr/zyklus/, 'folder cycles refused');
like($change->(op => 'mkdir', name => 'Bilder', parent => 'root')->{error}, qr/bereits/, 'duplicate sibling names refused');
like($change->(op => 'rmdir', id => $folder)->{error}, qr/leere/, 'nonempty folder refused');
like($change->(op => 'mkdir', name => '../outside', parent => 'root')->{error}, qr/Ordnername/, 'folder path traversal refused');
my $png = "\x89PNG\r\n\x1a\n" . ('x' x 30);
$reply = $upload->('Solar.png', $png, $subfolder);
ok(!$reply->{error}, 'image upload succeeds');
my $image = $state->{assets}[0];
is($image->{folder}, $subfolder, 'upload goes directly to selected folder');
like($image->{href}, qr{\Amedia/[0-9a-f]{32}\.png\z}, 'image retains compatible stable path');
ok(-f "$root/www/fhem-cms/CMS/$image->{href}", 'image stored in media folder');
$reply = $upload->('Duplicate.png', $png, 'root');
ok($reply->{duplicate}, 'identical image reuses existing asset');
is(scalar(@{$state->{assets}}), 1, 'deduplication keeps one record');
my $href = $image->{href};
$reply = $change->(op => 'move', id => $image->{id}, name => 'Umbenannt.png', folder => 'root');
ok(!$reply->{error}, 'rename and move asset');
is($state->{assets}[0]{href}, $href, 'move and rename keep widget URL unchanged');
like($change->(op => 'move', id => $image->{id}, name => 'Wrong.svg', folder => 'root')->{error}, qr/Dateiendung/, 'rename cannot change type');
like($upload->('x.png', 'not an actual image at all')->{error}, qr/Bildformat/, 'image signatures checked');
like($upload->('x.pdf', 'not an actual PDF')->{error}, qr/PDF/, 'PDF signatures checked');
like($upload->('x.docx', 'not an actual ZIP document')->{error}, qr/Archiv/, 'Office archive signature checked');
like($upload->('x.doc', 'not an OLE document')->{error}, qr/Office/, 'legacy Office signature checked');
for my $ext (qw(pdf doc docx xls xlsx ppt pptx odt ods odp txt csv)) {
    my $bytes = $ext eq 'pdf' ? "%PDF-1.7\n$ext" : $ext =~ /\A(?:doc|xls|ppt)\z/
        ? "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1$ext" : $ext =~ /\A(?:txt|csv)\z/ ? "Test $ext\n"
        : "PK\x03\x04$ext";
    $reply = $upload->("example.$ext", $bytes, $folder);
    ok(!$reply->{error}, "$ext upload succeeds");
    my ($document) = grep { $_->{id} eq $reply->{selected} } @{$state->{assets}};
    ok(!$document->{image}, "$ext is a document, never an image");
    like($document->{href}, qr{\A\.\./\.\./fhemcms-assets/CMS/[0-9a-f]{32}\z}, "$ext uses safe download endpoint");
    ok(-f "$dir/assets/$document->{file}", "$ext is stored outside web root");
}
my ($pdf) = grep { $_->{name} eq 'example.pdf' } @{$state->{assets}};
my $large = "%PDF-1.7\n" . ('a' x 150000);
$reply = $upload->('large.pdf', $large);
ok(!$reply->{error}, 'document uploads in multiple bounded chunks');
like($change->(op => 'begin', name => 'too-big.pdf', size => 20971521, folder => 'root')->{error}, qr/groesse/, 'per-document limit enforced before upload');
my $policy = $json->decode($json->encode($state->{policy}));
$policy->{types}{pdf} = JSON::PP::false;
$reply = $change->(op => 'policy', policy => $policy);
ok(!$reply->{error}, 'administration disables type');
like($upload->('disabled.pdf', '%PDF-1.7 new')->{error}, qr/gesperrt/, 'disabled type blocked');
ok(grep($_->{id} eq $pdf->{id}, @{$state->{assets}}), 'existing disabled-type document retained');
$policy->{types}{epub} = JSON::PP::true;
ok(!$change->(op => 'policy', policy => $policy)->{error}, 'additional passive type enabled');
ok(!$upload->('Book.epub', "PK\x03\x04example book")->{error}, 'additional type can be uploaded');
for my $ext (qw(html svg js sh exe php docm)) {
    my $bad = $json->decode($json->encode($policy));
    $bad->{types}{$ext} = JSON::PP::true;
    like($change->(op => 'policy', policy => $bad)->{error}, qr/Dateityp/, "active $ext cannot be enabled");
}
$policy->{totalBytes} = 100;
$policy->{documentBytes} = 50;
$policy->{imageBytes} = 50;
ok(!$change->(op => 'policy', policy => $policy)->{error}, 'limits configurable below existing usage without deleting assets');
like($upload->('small.txt', 'new')->{error}, qr/Gesamtspeicher/, 'total quota enforced');
$policy->{totalBytes} = 524288000; $policy->{documentBytes} = 20971520; $policy->{imageBytes} = 3145728;
$policy->{types}{pdf} = JSON::PP::true;
ok(!$change->(op => 'policy', policy => $policy)->{error}, 'restore limits');
my $legacyPolicy = $json->decode($json->encode($policy));
$legacyPolicy->{types}{png} = JSON::PP::false;
ok(!$change->(op => 'policy', policy => $legacyPolicy)->{error}, 'disable legacy image type too');
like(FHEMCMS_StoreMedia('CMS', encode_base64($png . 'other', '')), qr/gesperrt/, 'legacy image endpoint cannot bypass type policy');
ok(!$change->(op => 'policy', policy => $policy)->{error}, 'restore image type');
my $session = $change->(op => 'begin', name => 'interrupted.txt', folder => 'root', size => 10);
like($call->({op => 'chunk', upload => $session->{upload}, offset => 3, data => encode_base64('a','')})->{error}, qr/Uploadblock/, 'out-of-order chunk refused');
like($change->(op => 'finish', upload => $session->{upload})->{error}, qr/unvollstaendig/, 'incomplete upload refused');
ok($call->({op => 'cancel', upload => $session->{upload}})->{cancelled}, 'cancel removes upload');
ok(!keys(%FHEMCMS_ASSET_UPLOADS), 'no upload handles leak');
my $legacy = 'b' x 32 . '.gif';
write_bytes("$root/www/fhem-cms/CMS/media/$legacy", 'GIF89a' . ('x' x 40));
$state = $call->({op => 'list'});
ok(grep($_->{file} eq $legacy, @{$state->{assets}}), 'existing Textwidget media discovered without migration');
my $textWidget = { id => 'text', type => 'text', html => "<p><img src=\"$href\"> <a href=\"$pdf->{href}\">PDF</a></p>",
    grid => { col => 1, row => 2, w => 4, h => 4 } };
my $linkWidget = { id => 'links', type => 'fhem-link', grid => { col => 5, row => 2, w => 4, h => 4 }, links => [
    { id => 'link', kind => 'asset', asset => $pdf->{href}, text => 'Dokument',
        showText => JSON::PP::true, textPosition => 'above', target => 'self', image => $href,
        grid => {col => 1, row => 1, w => 4, h => 3} },
] };
push(@{$config->{pages}[0]{widgets}}, $textWidget, $linkWidget);
is(FHEMCMS_ValidateConfig($config, 5), undef, 'backend accepts document links in Textwidget and LinkWidget');
write_bytes("$dir/config.json", $json->encode($config));
write_bytes("$dir/draft.json", $json->encode($config));
$reply = $call->({op => 'usage', id => $image->{id}});
is(scalar(@{$reply->{usage}}), 4, 'image references found in both widgets and Live/Entwurf');
is($reply->{usage}[0]{page}, 'start', 'usage names page');
is($reply->{usage}[0]{widget}, 'text', 'usage names widget');
$reply = $change->(op => 'delete', id => $pdf->{id});
like($reply->{error}, qr/verwendet/, 'used document cannot be deleted even without frontend usage check');
is(scalar(@{$reply->{usage}}), 4, 'blocked deletion returns all locations');
ok(-f "$dir/assets/$pdf->{file}", 'blocked deletion leaves file untouched');
write_bytes("$dir/config.json", $initial);
write_bytes("$dir/draft.json", $initial);
$reply = $change->(op => 'delete', id => $image->{id});
ok(!$reply->{error}, 'unreferenced image can be deleted');
ok(!-e "$root/www/fhem-cms/CMS/$href", 'file removed only from Assetmanager deletion');
$reply = $change->(op => 'delete', id => $pdf->{id});
ok(!$reply->{error}, 'unreferenced document can be deleted');
ok(!-e "$dir/assets/$pdf->{file}", 'document file removed');
ok(!$change->(op => 'rmdir', id => $subfolder)->{error}, 'empty subfolder can be removed');
my $loaded = $call->({op => 'list'});
is_deeply($loaded, $state, 'catalog reload retains all metadata and policy');
my ($catalog) = FHEMCMS_AssetLoad('CMS');
my $oversized = $json->decode($json->encode($catalog));
$oversized->{assets} = [map { +{%{$catalog->{assets}[0]}, name => chr(0x1f600) x 180 . '.pdf'} } 1..2000];
eval { FHEMCMS_AssetSave($dir, $oversized); };
like($@, qr/1 MiB Metadaten/, 'oversized UTF-8 metadata rejected before creating unreadable catalog');
is_deeply($call->({op => 'list'}), $state, 'catalog size failure preserves prior state');
my ($doc) = grep { !$_->{image} } @{$state->{assets}};
$defs{CMS} = {TYPE => 'FHEMCMS'};
$FW_chash = {FD => 1};
$FW_headerlines = "X-FHEM-csrfToken: test\r\n";
my @download = FHEMCMS_AssetDownload("/fhemcms-assets/CMS/$doc->{id}");
ok(!defined($download[0]), 'download uses asynchronous response');
like($buffers[0], qr{Content-Type: application/octet-stream}, 'documents never execute as web content');
like($buffers[0], qr{Content-Disposition: attachment}, 'document download attachment');
like($buffers[0], qr{X-Content-Type-Options: nosniff}, 'download disallows sniffing');
like($buffers[0], qr{Content-Security-Policy: sandbox}, 'download sandbox header');
FHEMCMS_AssetDownloadChunk($FW_chash);
ok(length($buffers[1]) <= 65536, 'download emits bounded chunks');
FHEMCMS_AssetDownloadChunk($FW_chash);
ok(!exists($FW_chash->{'.fhemcmsAsset'}), 'download handle closes at EOF');
my ($bigDoc) = grep { $_->{name} eq 'large.pdf' } @{$state->{assets}};
$FW_chash = {FD => 1}; @buffers = ();
FHEMCMS_AssetDownload("/fhemcms-assets/CMS/$bigDoc->{id}");
for (1..4) { FHEMCMS_AssetDownloadChunk($FW_chash); }
is(length($buffers[1]), 65536, 'large download first block bounded to 64 KiB');
is(length($buffers[2]), 65536, 'large download next block bounded too');
is(join('', @buffers[1..3]), $large, 'large download bytes preserved exactly without reading entire file at once');
ok(!exists($FW_chash->{'.fhemcmsAsset'}), 'large download cleans up after EOF');
$authorized = 0;
@download = FHEMCMS_AssetDownload("/fhemcms-assets/CMS/$doc->{id}");
like($download[1], qr/nicht verfuegbar/, 'unauthorized download blocked');
@download = FHEMCMS_AssetDownload('/fhemcms-assets/CMS/../../etc/passwd');
like($download[1], qr/nicht verfuegbar/, 'download traversal blocked');
ok(@logs > 0, 'failures logged without upload content');
write_bytes("$dir/draft.json", 'not valid json with private content');
like($change->(op => 'delete', id => $doc->{id})->{error}, qr/JSON/, 'deletion fails closed when usage cannot be checked');
ok(-f "$dir/assets/$doc->{file}", 'invalid config does not lose asset');
ok(!grep(index(join(' ', @{$_}), 'private content') >= 0, @logs), 'parser error logs never include uploaded/config contents');
write_bytes("$dir/draft.json", $initial);
done_testing();
