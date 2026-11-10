package main;

use strict;
use warnings;
use Encode ();
use Fcntl qw(O_CREAT O_EXCL O_WRONLY);
use File::Spec;
use IO::Handle ();
use JSON::PP ();
use Digest::MD5 qw(md5_hex);
use Digest::SHA qw(sha256_hex);
use MIME::Base64 qw(decode_base64);

our (%FHEMCMS_ASSET_UPLOADS, %data, %defs, $FW_chash, $FW_headerlines, $FW_httpRetCode);
my $ASSET_ID = qr/\A[0-9a-f]{32}\z/;
my $ASSET_FOLDER = qr/\A(?:root|[0-9a-f]{32})\z/;
my $ASSET_BLOCKED = qr/\A(?:html?|xhtml|svgz?|xml|js|mjs|cjs|jsx|ts|tsx|css|php\d*|phtml|pl|pm|py|rb|sh|bash|zsh|bat|cmd|ps1|exe|dll|com|msi|jar|wasm|vbs|vbe|wsf|hta|lnk|url|swf|shtml|cgi|asp|aspx|jsp|docm|xlsm|pptm)\z/;
my $ASSET_JSON = JSON::PP->new->utf8->canonical;

sub FHEMCMS_AssetExact {
    my ($value, @keys) = @_;
    die "Ungueltige Asset-Anfrage\n" if (ref($value) ne 'HASH'
        || join(',', sort keys %{$value}) ne join(',', sort @keys));
}

sub FHEMCMS_AssetString {
    my ($value, $max) = @_;
    return defined($value) && !ref($value) && $ASSET_JSON->encode($value) =~ /\A"/
        && length($value) >= 1 && length($value) <= $max && $value =~ /\S/
        && $value ne '.' && $value ne '..' && $value !~ /[\x00-\x1f\x7f\/\\]/;
}

sub FHEMCMS_AssetDecode {
    my ($bytes) = @_;
    my $value = eval { $ASSET_JSON->decode($bytes) };
    my $error = $@;
    die "Asset-JSON ist ungueltig; Katalog oder Anfrage pruefen\n" if ($error);
    return $value;
}

sub FHEMCMS_AssetPolicy {
    my ($policy) = @_;
    FHEMCMS_AssetExact($policy, qw(imageBytes documentBytes totalBytes types));
    for my $key (qw(imageBytes documentBytes totalBytes)) {
        my $cap = $key eq 'totalBytes' ? 2147483648 : 52428800;
        die "Ungueltige Asset-Speichergrenze\n" if (!defined($policy->{$key}) || ref($policy->{$key})
            || $ASSET_JSON->encode($policy->{$key}) !~ /\A[0-9]+\z/
            || $policy->{$key} < 1 || $policy->{$key} > $cap);
    }
    die "Einzeldateigrenze ueber Gesamtspeichergrenze\n"
        if ($policy->{imageBytes} > $policy->{totalBytes} || $policy->{documentBytes} > $policy->{totalBytes});
    die "Ungueltige Dateitypenliste\n" if (ref($policy->{types}) ne 'HASH' || keys(%{$policy->{types}}) > 80);
    for my $ext (keys %{$policy->{types}}) {
        die "Dieser Dateityp ist nicht erlaubt\n" if ($ext !~ /\A[a-z][a-z0-9]{0,9}\z/ || $ext =~ $ASSET_BLOCKED);
        die "Dateityp-Freigabe muss boolesch sein\n" if (!JSON::PP::is_bool($policy->{types}{$ext}));
    }
}

sub FHEMCMS_AssetPaths {
    my ($name) = @_;
    die "Ungueltiges CMS-Device\n" if (!FHEMCMS_ValidName($name));
    my ($error, $dir) = FHEMCMS_CreateDataDir($name, 1);
    die "$error\n" if (defined($error));
    my ($mediaError, $media) = FHEMCMS_MediaDir($name);
    die "$mediaError\n" if (defined($mediaError));
    my $store = File::Spec->catdir($dir, 'assets');
    die "Assetverzeichnis darf kein Symlink sein\n" if (-l $store);
    return ($dir, $media, $store);
}

sub FHEMCMS_AssetLoad {
    my ($name) = @_;
    my ($dir, $media, $store) = FHEMCMS_AssetPaths($name);
    my $path = File::Spec->catfile($dir, 'assets.json');
    die "Assetkatalog darf kein Symlink sein\n" if (-l $path);
    my $catalog;
    if (-e $path) {
        my ($bytes, $error) = FHEMCMS_ReadFile($path);
        die "$error\n" if (defined($error));
        $catalog = FHEMCMS_AssetDecode($bytes);
    } else {
        $catalog = { folders => [], assets => [], policy => { imageBytes => 3145728,
            documentBytes => 20971520, totalBytes => 524288000,
            types => { map { $_ => JSON::PP::true } qw(png jpg jpeg gif pdf doc docx xls xlsx ppt pptx odt ods odp txt csv) } } };
    }
    FHEMCMS_AssetExact($catalog, qw(folders assets policy));
    FHEMCMS_AssetPolicy($catalog->{policy});
    die "Assetkatalog ist ungueltig oder zu gross\n"
        if (ref($catalog->{folders}) ne 'ARRAY' || ref($catalog->{assets}) ne 'ARRAY'
            || @{$catalog->{folders}} > 200 || @{$catalog->{assets}} > 2000);
    my %folders = (root => 1);
    for my $folder (@{$catalog->{folders}}) {
        FHEMCMS_AssetExact($folder, qw(id name parent));
        die "Ungueltiger Assetordner\n" if (!defined($folder->{id}) || ref($folder->{id}) || $folder->{id} !~ $ASSET_ID
            || $folders{$folder->{id}}++ || !FHEMCMS_AssetString($folder->{name}, 128)
            || !defined($folder->{parent}) || ref($folder->{parent}) || $folder->{parent} !~ $ASSET_FOLDER);
    }
    my %parents = map { $_->{id} => $_->{parent} } @{$catalog->{folders}};
    my %names;
    for my $folder (@{$catalog->{folders}}) {
        die "Doppelter Ordnername\n" if ($names{$folder->{parent} . '/' . lc($folder->{name})}++);
        my ($id, $depth) = ($folder->{id}, 0);
        while ($id ne 'root') {
            die "Ungueltiger Ordnerbaum (maximal 10 Ebenen)\n" if (++$depth > 10 || !$folders{$id});
            $id = $parents{$id};
        }
    }
    my %ids;
    my %files;
    for my $asset (@{$catalog->{assets}}) {
        FHEMCMS_AssetExact($asset, qw(id name folder file bytes image));
        die "Ungueltiges Asset\n" if (!defined($asset->{id}) || ref($asset->{id}) || $asset->{id} !~ $ASSET_ID
            || $ids{$asset->{id}}++ || !FHEMCMS_AssetString($asset->{name}, 180)
            || !defined($asset->{folder}) || ref($asset->{folder}) || !$folders{$asset->{folder}}
            || !JSON::PP::is_bool($asset->{image})
            || !defined($asset->{bytes}) || ref($asset->{bytes}) || $asset->{bytes} !~ /\A[0-9]+\z/);
        my $valid = $asset->{image} ? qr/\A[0-9a-f]{32}\.(?:png|jpg|gif)\z/ : qr/\A[0-9a-f]{32}\.bin\z/;
        die "Ungueltiger Assetpfad\n" if (!defined($asset->{file}) || ref($asset->{file}) || $asset->{file} !~ $valid || $files{$asset->{file}}++);
        my $file = File::Spec->catfile($asset->{image} ? $media : $store, $asset->{file});
        die "Assetdatei fehlt oder wurde extern veraendert\n" if (-l $file || !-f $file || (-s $file) != $asset->{bytes});
    }
    if (-d $media) {
        opendir(my $dh, $media) or die "Bilder konnten nicht gelesen werden: $!\n";
        my @existing = sort grep { /\A[0-9a-f]{32}\.(?:png|jpg|gif)\z/ } readdir($dh);
        closedir($dh);
        for my $file (@existing) {
            die "Bilddatei darf kein Symlink sein\n" if (-l File::Spec->catfile($media, $file));
            next if ($files{$file});
            my ($id) = $file =~ /\A([0-9a-f]{32})/;
            die "Doppelte Asset-ID\n" if ($ids{$id}++);
            push(@{$catalog->{assets}}, { id => $id, name => $file, folder => 'root', file => $file,
                bytes => 0 + (-s File::Spec->catfile($media, $file)), image => JSON::PP::true });
        }
    }
    die "Hoechstens 2000 Assets erlaubt\n" if (@{$catalog->{assets}} > 2000);
    return ($catalog, sha256_hex($ASSET_JSON->encode($catalog)), $dir, $media, $store);
}

sub FHEMCMS_AssetPublic {
    my ($name, $catalog, $token) = @_;
    my $total = 0;
    my @assets = map {
        $total += $_->{bytes};
        +{ %$_, href => $_->{image} ? "media/$_->{file}" : "../../fhemcms-assets/$name/$_->{id}" }
    } @{$catalog->{assets}};
    return { token => $token, folders => $catalog->{folders}, assets => \@assets,
        policy => $catalog->{policy}, totalBytes => $total };
}

sub FHEMCMS_AssetSave {
    my ($dir, $catalog) = @_;
    my $bytes = $ASSET_JSON->encode($catalog);
    die "Assetkatalog ueberschreitet 1 MiB Metadaten; Namen oder Assetanzahl reduzieren\n"
        if (length($bytes) > 1048576);
    my $path = File::Spec->catfile($dir, 'assets.json');
    my $tmp = "$path.tmp";
    die "Assetkatalog darf kein Symlink sein\n" if (-l $path || -l $tmp);
    sysopen(my $fh, $tmp, O_WRONLY | O_CREAT | O_EXCL, 0640) or die "Assetkatalog konnte nicht angelegt werden: $!\n";
    binmode($fh, ':raw');
    my $ok = print {$fh} $bytes;
    $ok = $fh->sync() && $ok;
    $ok = close($fh) && $ok;
    if (!$ok || !rename($tmp, $path)) {
        my $error = "$!";
        unlink($tmp) or Log3('FHEMCMS', 1, 'FHEMCMS: temporaerer Assetkatalog konnte nicht entfernt werden');
        die "Assetkatalog konnte nicht gespeichert werden: $error\n";
    }
}

sub FHEMCMS_AssetUsage {
    my ($name, $asset) = @_;
    my ($dir) = FHEMCMS_AssetPaths($name);
    my $href = $asset->{image} ? "media/$asset->{file}" : "../../fhemcms-assets/$name/$asset->{id}";
    my @usage;
    for my $entry (['config.json', 'Live'], ['draft.json', 'Entwurf']) {
        my $path = File::Spec->catfile($dir, $entry->[0]);
        next if ($entry->[0] eq 'draft.json' && !-e $path && !-l $path);
        my ($bytes, $error) = FHEMCMS_ReadFile($path);
        die "$error\n" if (defined($error));
        my $config = FHEMCMS_AssetDecode($bytes);
        die "Verwendungen koennen nicht sicher geprueft werden\n" if (ref($config) ne 'HASH' || ref($config->{pages}) ne 'ARRAY');
        for my $page (@{$config->{pages}}) {
            die "Ungueltige Seite bei Verwendungspruefung\n" if (ref($page) ne 'HASH' || ref($page->{widgets}) ne 'ARRAY');
            for my $widget (@{$page->{widgets}}) {
                if (index($ASSET_JSON->encode($widget), $href) >= 0
                    || (!$asset->{image} && index($ASSET_JSON->encode($widget), "/$asset->{id}") >= 0)) {
                    push(@usage, { source => $entry->[1], page => $page->{id},
                        pageTitle => $page->{title}, widget => $widget->{id}, title => $widget->{title} // $widget->{type} });
                }
            }
        }
    }
    return \@usage;
}

sub FHEMCMS_AssetDirectory {
    my ($path) = @_;
    die "Assetverzeichnis darf kein Symlink sein\n" if (-l $path);
    return if (-d $path);
    mkdir($path, 0750) or die "Assetverzeichnis konnte nicht angelegt werden: $!\n";
}

sub FHEMCMS_AssetUploadExpired {
    my ($id) = @_;
    my $upload = delete($FHEMCMS_ASSET_UPLOADS{$id});
    return if (!$upload);
    close($upload->{fh}) or Log3($upload->{name}, 1, 'FHEMCMS: Upload konnte nicht geschlossen werden') if ($upload->{fh});
    unlink($upload->{path}) or Log3($upload->{name}, 1, 'FHEMCMS: Uploadrest konnte nicht entfernt werden') if (-e $upload->{path});
}

sub FHEMCMS_AssetRequest {
    my ($name, $request) = @_;
    my ($catalog, $token, $dir, $media, $store) = FHEMCMS_AssetLoad($name);
    die "Asset-Anfrage fehlt\n" if (ref($request) ne 'HASH');
    my $op = $request->{op} // '';
    return FHEMCMS_AssetPublic($name, $catalog, $token) if ($op eq 'list');
    my $asset = sub {
        my ($id) = @_;
        die "Ungueltige Asset-ID\n" if (!defined($id) || ref($id) || $id !~ $ASSET_ID);
        my ($found) = grep { $_->{id} eq $id } @{$catalog->{assets}};
        die "Asset nicht gefunden\n" if (!$found);
        return $found;
    };
    if ($op eq 'usage') { return { usage => FHEMCMS_AssetUsage($name, $asset->($request->{id})) }; }
    if ($op eq 'cancel') {
        FHEMCMS_AssetExact($request, qw(op upload));
        my $upload = $FHEMCMS_ASSET_UPLOADS{$request->{upload} // ''};
        die "Upload nicht gefunden\n" if (!$upload || $upload->{name} ne $name);
        RemoveInternalTimer($request->{upload}, 'FHEMCMS_AssetUploadExpired');
        FHEMCMS_AssetUploadExpired($request->{upload});
        return { cancelled => JSON::PP::true };
    }
    if ($op eq 'chunk') {
        FHEMCMS_AssetExact($request, qw(op upload offset data));
        my $upload = $FHEMCMS_ASSET_UPLOADS{$request->{upload} // ''};
        die "Upload nicht gefunden\n" if (!$upload || $upload->{name} ne $name);
        die "Ungueltiger Uploadblock\n" if (!defined($request->{data}) || ref($request->{data})
            || length($request->{data}) > 87384 || $request->{data} !~ /\A[A-Za-z0-9+\/]+={0,2}\z/ || length($request->{data}) % 4
            || !defined($request->{offset}) || ref($request->{offset}) || $request->{offset} !~ /\A[0-9]+\z/
            || $request->{offset} != $upload->{received});
        my $bytes = decode_base64($request->{data});
        die "Upload groesser als angekuendigt\n" if ($upload->{received} + length($bytes) > $upload->{size});
        print {$upload->{fh}} $bytes or die "Uploadblock konnte nicht gespeichert werden: $!\n";
        $upload->{head} .= substr($bytes, 0, 65536 - length($upload->{head})) if (length($upload->{head}) < 65536);
        $upload->{md5}->add($bytes);
        $upload->{sha}->add($bytes);
        $upload->{received} += length($bytes);
        return { received => $upload->{received} };
    }
    die "Assetkatalog wurde geaendert; bitte neu laden\n"
        if (!defined($request->{token}) || ref($request->{token}) || $request->{token} ne $token);
    my %folders = (root => 1, map { $_->{id} => 1 } @{$catalog->{folders}});
    my $folderCheck = sub { die "Ordner nicht gefunden\n" if (!defined($_[0]) || ref($_[0]) || !$folders{$_[0]}); };
    if ($op eq 'begin') {
        FHEMCMS_AssetExact($request, qw(op token folder name size));
        $folderCheck->($request->{folder});
        die "Ungueltiger Dateiname\n" if (!FHEMCMS_AssetString($request->{name}, 180) || $request->{name} !~ /\.([a-zA-Z0-9]{1,10})\z/);
        my $ext = lc($1);
        die "Dateityp ist gesperrt\n" if (!$catalog->{policy}{types}{$ext} || $ext =~ $ASSET_BLOCKED);
        my $image = $ext =~ /\A(?:png|jpe?g|gif)\z/;
        die "Ungueltige Dateigroesse\n" if (!defined($request->{size}) || ref($request->{size})
            || $ASSET_JSON->encode($request->{size}) !~ /\A[0-9]+\z/ || $request->{size} < 1
            || $request->{size} > $catalog->{policy}{$image ? 'imageBytes' : 'documentBytes'});
        my $total = $request->{size};
        $total += $_->{bytes} for @{$catalog->{assets}};
        die "Gesamtspeichergrenze oder Assetanzahl erreicht\n" if ($total > $catalog->{policy}{totalBytes} || @{$catalog->{assets}} >= 2000);
        die "Fuer dieses Device laeuft bereits ein Upload\n" if (grep { $_->{name} eq $name } values %FHEMCMS_ASSET_UPLOADS);
        FHEMCMS_AssetDirectory($store);
        opendir(my $dh, $store) or die "Uploadverzeichnis konnte nicht gelesen werden: $!\n";
        my @expired = grep { /\A\.[0-9a-f]{32}\.upload\z/ } readdir($dh);
        closedir($dh);
        for my $file (@expired) {
            my $old = File::Spec->catfile($store, $file);
            die "Uploadrest darf kein Symlink sein\n" if (-l $old);
            next if (!-f $old || time() - (stat($old))[9] < 900);
            unlink($old) or die "Abgelaufener Upload konnte nicht bereinigt werden: $!\n";
        }
        my $id = substr(sha256_hex(join(':', $name, time(), $$, rand(), $token)), 0, 32);
        my $path = File::Spec->catfile($store, ".$id.upload");
        sysopen(my $fh, $path, O_WRONLY | O_CREAT | O_EXCL, 0600) or die "Upload konnte nicht angelegt werden: $!\n";
        binmode($fh, ':raw');
        $FHEMCMS_ASSET_UPLOADS{$id} = { name => $name, path => $path, fh => $fh, ext => $ext, image => $image,
            token => $token, filename => $request->{name}, folder => $request->{folder}, size => $request->{size},
            received => 0, head => '', md5 => Digest::MD5->new, sha => Digest::SHA->new(256) };
        InternalTimer(time() + 900, 'FHEMCMS_AssetUploadExpired', $id, 0);
        return { upload => $id, chunkBytes => 65536 };
    } elsif ($op eq 'finish') {
        FHEMCMS_AssetExact($request, qw(op token upload));
        my $upload = $FHEMCMS_ASSET_UPLOADS{$request->{upload} // ''};
        die "Upload nicht gefunden\n" if (!$upload || $upload->{name} ne $name || $upload->{token} ne $token);
        die "Upload ist unvollstaendig\n" if ($upload->{received} != $upload->{size});
        my ($head, $ext) = @{$upload}{qw(head ext)};
        if ($upload->{image}) {
            die "Bildformat stimmt nicht mit Dateiendung ueberein\n" if (
                ($ext eq 'png' && substr($head, 0, 8) ne "\x89PNG\r\n\x1a\n")
                || ($ext =~ /jpe?g/ && substr($head, 0, 3) ne "\xff\xd8\xff")
                || ($ext eq 'gif' && $head !~ /\AGIF8[79]a/));
            $ext = 'jpg' if ($ext eq 'jpeg');
        } elsif ($ext eq 'pdf') {
            die "Ungueltiges PDF-Dokument\n" if ($head !~ /\A%PDF-\d\.\d/);
        } elsif ($ext =~ /\A(?:doc|xls|ppt)\z/) {
            die "Ungueltiges Office-Dokument\n" if (substr($head, 0, 8) ne "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
        } elsif ($ext =~ /\A(?:docx|xlsx|pptx|odt|ods|odp)\z/) {
            die "Ungueltiges Office-/OpenDocument-Archiv\n" if (substr($head, 0, 4) ne "PK\x03\x04");
        } elsif ($ext eq 'txt' || $ext eq 'csv') {
            die "Textdatei enthaelt binaere Steuerzeichen\n" if ($head =~ /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
        }
        my $id = $upload->{image} ? $upload->{md5}->hexdigest : substr($upload->{sha}->hexdigest, 0, 32);
        my $file = $upload->{image} ? "$id.$ext" : "$id.bin";
        my ($existing) = grep { $_->{id} eq $id } @{$catalog->{assets}};
        if ($existing) {
            RemoveInternalTimer($request->{upload}, 'FHEMCMS_AssetUploadExpired');
            FHEMCMS_AssetUploadExpired($request->{upload});
            return { state => FHEMCMS_AssetPublic($name, $catalog, $token), selected => $id, duplicate => JSON::PP::true };
        }
        my $out = delete($upload->{fh});
        $out->sync() or die "Upload konnte nicht synchronisiert werden: $!\n";
        close($out) or die "Upload konnte nicht geschlossen werden: $!\n";
        FHEMCMS_AssetDirectory($media) if ($upload->{image});
        my $target = File::Spec->catfile($upload->{image} ? $media : $store, $file);
        die "Zieldatei existiert bereits\n" if (-e $target || -l $target);
        rename($upload->{path}, $target) or die "Upload konnte nicht uebernommen werden: $!\n";
        push(@{$catalog->{assets}}, { id => $id, file => $file, name => $upload->{filename}, folder => $upload->{folder},
            bytes => $upload->{size}, image => $upload->{image} ? JSON::PP::true : JSON::PP::false });
        my $saved = eval { FHEMCMS_AssetSave($dir, $catalog); 1 };
        my $error = $@;
        if (!$saved) {
            unlink($target) or Log3($name, 1, 'FHEMCMS: fehlgeschlagener Upload konnte nicht zurueckgenommen werden');
            die $error;
        }
        RemoveInternalTimer($request->{upload}, 'FHEMCMS_AssetUploadExpired');
        delete($FHEMCMS_ASSET_UPLOADS{$request->{upload}});
        return { state => FHEMCMS_AssetPublic($name, $catalog, sha256_hex($ASSET_JSON->encode($catalog))), selected => $id };
    } elsif ($op eq 'mkdir' || $op eq 'folder') {
        FHEMCMS_AssetExact($request, $op eq 'mkdir' ? qw(op token name parent) : qw(op token id name parent));
        $folderCheck->($request->{parent});
        die "Ungueltiger Ordnername\n" if (!FHEMCMS_AssetString($request->{name}, 128));
        my $id = $op eq 'mkdir' ? substr(sha256_hex(join(':', $token, $request->{name}, rand())), 0, 32) : $request->{id};
        my ($folder) = grep { $_->{id} eq $id } @{$catalog->{folders}};
        die "Ordner nicht gefunden\n" if ($op eq 'folder' && !$folder);
        if (!$folder) { $folder = { id => $id }; push(@{$catalog->{folders}}, $folder); }
        @{$folder}{qw(name parent)} = @{$request}{qw(name parent)};
        die "Hoechstens 200 Ordner erlaubt\n" if (@{$catalog->{folders}} > 200);
        my %parents = map { $_->{id} => $_->{parent} } @{$catalog->{folders}};
        for my $item (@{$catalog->{folders}}) {
            my ($current, $depth) = ($item->{id}, 0);
            while ($current ne 'root') {
                die "Ordnerzyklus oder mehr als 10 Ebenen\n" if (++$depth > 10);
                $current = $parents{$current};
            }
            die "Ordnername ist hier bereits vergeben\n" if (grep {
                $_->{id} ne $item->{id} && $_->{parent} eq $item->{parent} && lc($_->{name}) eq lc($item->{name})
            } @{$catalog->{folders}});
        }
    } elsif ($op eq 'rmdir') {
        FHEMCMS_AssetExact($request, qw(op token id));
        $folderCheck->($request->{id});
        die "Nur leere Unterordner koennen geloescht werden\n" if ($request->{id} eq 'root'
            || (grep { $_->{folder} eq $request->{id} } @{$catalog->{assets}})
            || (grep { $_->{parent} eq $request->{id} } @{$catalog->{folders}}));
        $catalog->{folders} = [grep { $_->{id} ne $request->{id} } @{$catalog->{folders}}];
    } elsif ($op eq 'move') {
        FHEMCMS_AssetExact($request, qw(op token id name folder));
        my $item = $asset->($request->{id});
        $folderCheck->($request->{folder});
        die "Ungueltiger Dateiname\n" if (!FHEMCMS_AssetString($request->{name}, 180));
        my ($oldExt) = $item->{name} =~ /\.([^.]+)\z/;
        my ($newExt) = $request->{name} =~ /\.([^.]+)\z/;
        die "Dateiendung darf nicht veraendert werden\n" if (!defined($oldExt) || !defined($newExt) || lc($oldExt) ne lc($newExt));
        @{$item}{qw(name folder)} = @{$request}{qw(name folder)};
    } elsif ($op eq 'delete') {
        FHEMCMS_AssetExact($request, qw(op token id));
        my $item = $asset->($request->{id});
        my $usage = FHEMCMS_AssetUsage($name, $item);
        return { error => 'Asset wird noch verwendet; zuerst Verweise entfernen', usage => $usage } if (@{$usage});
        my $path = File::Spec->catfile($item->{image} ? $media : $store, $item->{file});
        my $quarantine = File::Spec->catfile($store, ".$item->{id}.deleted");
        FHEMCMS_AssetDirectory($store);
        die "Loeschrest vorhanden; bitte pruefen\n" if (-e $quarantine || -l $quarantine);
        rename($path, $quarantine) or die "Asset konnte nicht entfernt werden: $!\n";
        $catalog->{assets} = [grep { $_->{id} ne $item->{id} } @{$catalog->{assets}}];
        my $saved = eval { FHEMCMS_AssetSave($dir, $catalog); 1 };
        my $error = $@;
        if (!$saved) {
            rename($quarantine, $path) or Log3($name, 1, 'FHEMCMS: geloeschtes Asset konnte nicht zurueckgelegt werden');
            die $error;
        }
        unlink($quarantine) or die "Assetdatei konnte nicht endgueltig geloescht werden: $!\n";
    } elsif ($op eq 'policy') {
        FHEMCMS_AssetExact($request, qw(op token policy));
        FHEMCMS_AssetPolicy($request->{policy});
        $catalog->{policy} = $request->{policy};
    } else { die "Unbekannte Asset-Aktion\n"; }
    FHEMCMS_AssetSave($dir, $catalog) if ($op ne 'delete');
    return { state => FHEMCMS_AssetPublic($name, $catalog, sha256_hex($ASSET_JSON->encode($catalog))) };
}

sub FHEMCMS_AssetsDispatch {
    my ($name, $payload) = @_;
    my $result = eval {
        die "Asset-Anfrage ist zu gross\n" if (length($payload // '') > 180000);
        die "Ungueltige Assetkodierung\n" if (!ref($payload) && (!defined($payload)
            || $payload !~ /\A[A-Za-z0-9+\/]+={0,2}\z/ || length($payload) % 4));
        my $request = ref($payload) eq 'HASH' ? $payload : FHEMCMS_AssetDecode(decode_base64($payload));
        FHEMCMS_AssetRequest($name, $request);
    };
    my $error = $@;
    if ($error) {
        $error =~ s/[\x00-\x1f\x7f]+/ /g;
        $error =~ s/ at .*? line .*//;
        $error = substr($error, 0, 240);
        Log3($name, 2, "FHEMCMS: Asset-Aktion abgewiesen: $error");
        $result = { error => $error };
    }
    Log3($name, 3, 'FHEMCMS: Asset-Loeschung wegen bestehender Verwendung abgewiesen')
        if (ref($result) eq 'HASH' && $result->{usage} && $result->{error});
    return $ASSET_JSON->encode($result);
}

sub FHEMCMS_AssetDownload {
    my ($arg) = @_;
    my ($path, $filename);
    my $ok = eval {
        die "Ungueltiger Assetdownload\n" if ($arg !~ m{\A/fhemcms-assets/([A-Za-z0-9_.-]{1,128})/([0-9a-f]{32})\z});
        my ($name, $id) = ($1, $2);
        die "Zugriff verweigert\n" if (!Authorized($FW_chash, 'cmd', 'get') || !Authorized($FW_chash, 'devicename', $name));
        die "CMS-Device nicht gefunden\n" if (!$defs{$name} || ($defs{$name}{TYPE} // '') ne 'FHEMCMS');
        my ($catalog, undef, undef, undef, $store) = FHEMCMS_AssetLoad($name);
        my ($asset) = grep { $_->{id} eq $id && !$_->{image} } @{$catalog->{assets}};
        die "Dokument nicht gefunden\n" if (!$asset);
        $filename = $asset->{name};
        $path = File::Spec->catfile($store, $asset->{file});
        1;
    };
    my $error = $@;
    if (!$ok) {
        $error =~ s/[\x00-\x1f\x7f]/ /g;
        Log3('FHEMCMS', 2, 'FHEMCMS: Assetdownload abgewiesen');
        $FW_httpRetCode = '404 Not Found';
        return ('text/plain; charset=utf-8', 'Dokument nicht verfuegbar');
    }
    open(my $fh, '<:raw', $path) or do {
        $FW_httpRetCode = '500 Internal Server Error';
        Log3('FHEMCMS', 1, 'FHEMCMS: Assetdownload konnte nicht geoeffnet werden');
        return ('text/plain', 'Dokument konnte nicht gelesen werden');
    };
    my $encoded = Encode::encode('UTF-8', $filename);
    $encoded =~ s/([^A-Za-z0-9._-])/sprintf('%%%02X', ord($1))/ge;
    $FW_chash->{'.fhemcmsAsset'} = $fh;
    my $header = "HTTP/1.1 200 OK\r\n" . ($FW_headerlines // '')
        . "Content-Type: application/octet-stream\r\nX-Content-Type-Options: nosniff\r\n"
        . "Content-Security-Policy: sandbox\r\nContent-Disposition: attachment; filename=\"document\"; filename*=UTF-8''$encoded\r\n"
        . "Content-Length: " . (-s $path) . "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
    if (!FW_addToWritebuffer($FW_chash, $header, 'FHEMCMS_AssetDownloadNext', 0, 1)) {
        close($fh);
        delete($FW_chash->{'.fhemcmsAsset'});
        Log3('FHEMCMS', 1, 'FHEMCMS: Assetdownload konnte nicht gestartet werden');
        TcpServer_Close($FW_chash, 1, 1) if (defined($FW_chash->{FD}));
    }
    return (undef, undef);
}

sub FHEMCMS_AssetDownloadNext {
    my ($connection) = @_;
    InternalTimer(time(), 'FHEMCMS_AssetDownloadChunk', $connection, 0);
}

sub FHEMCMS_AssetDownloadChunk {
    my ($connection) = @_;
    my $fh = $connection->{'.fhemcmsAsset'};
    return if (!$fh);
    my $bytes;
    my $read = defined($connection->{FD}) ? read($fh, $bytes, 65536) : 0;
    if (!$read) {
        Log3('FHEMCMS', 1, 'FHEMCMS: Assetdownload beim Lesen fehlgeschlagen') if (!defined($read));
        close($fh);
        delete($connection->{'.fhemcmsAsset'});
        TcpServer_Close($connection, 1, 1) if (defined($connection->{FD}));
        return;
    }
    if (!FW_addToWritebuffer($connection, $bytes, 'FHEMCMS_AssetDownloadNext', 0, 1)) {
        close($fh);
        delete($connection->{'.fhemcmsAsset'});
        Log3('FHEMCMS', 1, 'FHEMCMS: Assetdownload konnte nicht fortgesetzt werden');
        TcpServer_Close($connection, 1, 1) if (defined($connection->{FD}));
    }
}

sub FHEMCMS_AssetLegacyPolicy {
    my ($name, $ext, $bytes) = @_;
    my $ok = eval {
        my ($catalog) = FHEMCMS_AssetLoad($name);
        die "Dieser Bildtyp ist in der Assetverwaltung gesperrt\n"
            if (!$catalog->{policy}{types}{$ext} && !($ext eq 'jpg' && $catalog->{policy}{types}{jpeg}));
        die "Bild ueberschreitet die konfigurierte Assetgrenze\n" if (length($bytes) > $catalog->{policy}{imageBytes});
        my $file = md5_hex($bytes) . ".$ext";
        return undef if (grep { $_->{file} eq $file } @{$catalog->{assets}});
        my $total = length($bytes);
        $total += $_->{bytes} for @{$catalog->{assets}};
        die "Asset-Gesamtspeichergrenze erreicht\n" if ($total > $catalog->{policy}{totalBytes} || @{$catalog->{assets}} >= 2000);
        1;
    };
    my $error = $@;
    return undef if (!$error);
    $error =~ s/[\x00-\x1f\x7f]/ /g;
    return substr($error, 0, 240);
}

1;
