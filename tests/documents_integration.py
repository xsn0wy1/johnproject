"""Document APIs: run only against a disposable *_test database and private test storage."""
import hashlib
import io
import json
import os
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from auth_integration import Client, PASSWORD, ADMIN_PASSWORD, SUFFIX, PHP, sql

assert os.environ["HOSPITAL_DB_NAME"].endswith("_test")
ROOT = Path(__file__).resolve().parents[1]
checks = 0

def check(condition, label):
    global checks
    assert condition, label
    checks += 1
    print("PASS", label, flush=True)

def pdf_bytes(label="Documento de prueba", pages=2):
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for number in range(1, pages + 1):
        page_id = len(objects) + 1
        kids.append(f"{page_id} 0 R")
        stream = f"BT /F1 22 Tf 64 730 Td ({label} - Pagina {number}) Tj ET\n"
        objects.extend([f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_id+1} 0 R >>", f"<< /Length {len(stream)} >>\nstream\n{stream}endstream"])
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {pages} >>"
    result = b"%PDF-1.4\n"; offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f"{number} 0 obj\n{obj}\nendobj\n".encode()
    xref = len(result)
    result += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    for offset in offsets[1:]: result += f"{offset:010d} 00000 n \n".encode()
    result += f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return result

def docx_bytes(extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Prueba</w:t></w:r></w:p></w:body></w:document>')
        for name, data in (extra or {}).items(): z.writestr(name, data)
    return output.getvalue()

def upload(client, fields, content, name="prueba.pdf", endpoint="create", csrf=True):
    boundary = "Hospital" + secrets.token_hex(12)
    parts = []
    for key, value in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{'' if value is None else value}\r\n".encode())
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode() + content + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    headers = {"Content-Type": "multipart/form-data; boundary=" + boundary, "Accept": "application/json"}
    if csrf: headers["X-CSRF-Token"] = client.token
    request = urllib.request.Request(client.base + "/api/v1/documents/" + endpoint + ".php", data=b"".join(parts), headers=headers)
    try: response = client.opener.open(request, timeout=30)
    except urllib.error.HTTPError as error: response = error
    return response.status, json.loads(response.read())

def binary(client, id, version=None, extra="", method="GET", range=None):
    url = client.base + "/api/v1/documents/content.php?id=" + id + (("&version=" + str(version)) if version else "") + extra
    request = urllib.request.Request(url, method=method, headers={"Range": range} if range else {})
    try: response = client.opener.open(request, timeout=15)
    except urllib.error.HTTPError as error: response = error
    return response.status, response.read(), response.headers

def fields(client, category, patient=None, title="Informe de prueba"):
    token = client.call("/api/v1/documents/create-token.php")[1]["data"]["create_token"]
    return {"title": title, "description": "Ficción · Sin datos reales", "document_date": "2026-10-12", "category_id": category, "patient_id": patient, "create_token": token}

def detail(client, id):
    return client.call("/api/v1/documents/get.php?id=" + id)[1]["data"]

def metadata(item, **overrides):
    data = {"id": item["id"], "version": item["version"], "title": item["title"], "description": item["description"], "document_date": item["document_date"], "category_id": item["category"]["id"], "patient_id": item["patient"]["id"] if item["patient"] else None}
    return {**data, **overrides}

def admin_sql(statement):
    program = '''require 'backend/php/autoload.php'; $c=Hospital\\Config::load();
    if(!str_ends_with($c['db']['name'],'_test'))exit(1);
    $c['db']['user']=getenv('HOSPITAL_SETUP_DB_USER') ?: 'root';
    $c['db']['password']=getenv('HOSPITAL_SETUP_DB_PASSWORD') ?: '';
    Hospital\\Database::connect($c)->exec(stream_get_contents(STDIN));'''
    subprocess.run([PHP, '-r', program], input=statement, text=True, cwd=ROOT, capture_output=True, check=True)

def main():
    admin = Client(); assert admin.login("system_admin", ADMIN_PASSWORD)[0] == 200
    accounts = []
    for index, role in enumerate(["staff", "staff", "records_manager"]):
        client = Client(); client.csrf(); username = f"docs_{SUFFIX}_{index}"
        status, payload, _ = client.call("/api/v1/auth/register.php", "POST", {"username": username, "email": username+"@hospital.example", "national_id": str(80000000+secrets.randbelow(9999999)), "password": PASSWORD})
        assert status == 201, payload
        uid = payload["data"]["user_id"]
        assert admin.call("/api/v1/admin/users/approve.php", "POST", {"user_id": uid, "role": role})[0] == 200
        assert client.login(username, PASSWORD)[0] == 200
        accounts.append((client, uid, username))
    first, uid, username = accounts[0]; second, other_uid, _ = accounts[1]; manager, _, _ = accounts[2]
    categories = first.call("/api/v1/catalogs/document-categories.php")[1]["data"]
    medical = next(item["id"] for item in categories if item["code"] == "medical_report")
    administrative = next(item["id"] for item in categories if item["code"] == "administrative")
    national = str(70000000+secrets.randbelow(9999999))
    sql(f"INSERT INTO patients (national_id,full_name) VALUES ('{national}', 'Paciente de prueba {SUFFIX}')")
    patient = str(sql("SELECT id FROM patients WHERE national_id='"+national+"'")[0]["id"])
    check(Client().call("/api/v1/documents/list.php")[0] == 401, "document list requires an active session")
    check(Client().call("/api/v1/catalogs/patients.php", "POST", {"q":"prueba"})[0] == 401, "patient suggestions require authentication")
    check(first.call("/api/v1/documents/list.php")[1]["data"] == [], "new users see no placeholder documents")
    suggestions = first.call("/api/v1/catalogs/patients.php", "POST", {"q":national})[1]["data"]
    check(any(item["id"]==patient for item in suggestions) and set(suggestions[0])=={"id","full_name","national_id"}, "hospital-managed patient lookup returns only selection identity")
    check(first.call("/api/v1/catalogs/patients.php", "POST", {"q":"x"})[1]["data"]==[], "patient search is bounded and requires two characters")
    check(first.call('/api/v1/catalogs/patients.php?q='+national)[0]==405 and first.call('/api/v1/catalogs/patients.php','POST',{'q':national},csrf=False)[0]==403, 'patient searches use CSRF-protected bodies instead of identity in URLs')
    original = pdf_bytes()
    basic = fields(first, medical, patient)
    basic['description'] = 'Ficción · Sin datos reales\nSegunda línea de descripción'
    storage = Path(os.environ["HOSPITAL_STORAGE_PATH"])
    def files(): return set(storage.rglob("*.bin")) if storage.exists() else set()
    baseline = files()
    check(upload(first,basic,original,csrf=False)[0]==403, "uploads require CSRF")
    check(upload(first,{**basic,"uploader_user_id":other_uid},original)[0]==422, "client cannot assign another uploader")
    check(upload(first,{**basic,"patient_id":None},original)[0]==422, "clinical categories require an existing patient")
    check(upload(first,{**basic,"patient_id":"999999999"},original)[0]==422, "nonexistent patient IDs are rejected")
    check(upload(first,{**basic,"document_date":"2026-02-30"},original)[0]==422, "invalid calendar dates are rejected")
    check(upload(first,basic,b"<html><script>alert(1)</script></html>")[0]==415, "HTML disguised as PDF is rejected")
    check(upload(first,basic,b"%PDF-1.4\nNot a PDF object graph.\n%%EOF\n")[0]==415, "a PDF-looking header without a cross-reference is rejected")
    check(upload(first,basic,original,"prueba.pptx")[0]==415, "PPTX is consistently unsupported")
    check(upload(first,basic,b"x"*(10*1048576+1))[0]==413, "server enforces the ten-MiB file limit")
    check(files()==baseline, "rejected uploads leave no staged or published bytes")
    probe_url = os.environ.get('HOSPITAL_DOCUMENT_FAILURE_TEST_URL')
    if probe_url:
        probe = first.copy_session(); probe.base = probe_url
        check(upload(probe,basic,original)[0]==503 and files()==baseline, 'an unavailable configured scanner fails closed and removes quarantined bytes')
    status, payload = upload(first,basic,original)
    check(status==201, "valid PDF creates a real database record")
    item = payload["data"]; id = item["id"]
    check(item['description'] == basic['description'] and detail(first,id)['description'] == basic['description'], 'multiline descriptions round-trip without collapsing paragraph breaks')
    check(item["file"]["byte_size"]==len(original) and item["file"]["sha256"]==hashlib.sha256(original).hexdigest() and item["patient"]["id"]==patient, "metadata stores exact bytes, digest and canonical patient relation")
    check("path" not in json.dumps(item) and len(files()-baseline)==1 and not list((storage/"quarantine").glob("*.bin")), "only opaque private file paths exist and quarantine is cleared")
    status, replay = upload(first,basic,original)
    check(status==201 and replay["data"]["id"]==id and len(files()-baseline)==1, "retry token prevents duplicate records and files")
    check(upload(first,{**basic,"title":"Changed retry"},original)[0]==409, "reusing a create token with different content fails")
    check(binary(first,id)[1]==original, "authenticated preview returns original PDF bytes")
    check(binary(first,id,extra="&download=1")[1]==original, "download bytes match the upload exactly")
    check(binary(Client(),id)[0]==401 and binary(second,id)[0]==404, "anonymous and unrelated staff cannot retrieve document bytes")
    check(second.call("/api/v1/documents/get.php?id="+id)[0]==404, "metadata is scoped by document permission")
    check(second.call("/api/v1/documents/list.php")[1]["data"]==[], "list and count do not leak another uploader's documents")
    check(admin.call("/api/v1/documents/get.php?id="+id)[0]==404, "account administration does not implicitly grant clinical document access")
    check(manager.call("/api/v1/documents/get.php?id="+id)[0]==200 and binary(manager,id)[0]==200, "records managers can access hospital documents")
    check(first.call("/api/v1/documents/content.php?id="+id+"&source=/etc/passwd")[0]==422, "binary handler rejects arbitrary source/path parameters")
    status, data, headers = binary(first,id,range="bytes=0-8")
    check(status==206 and data==original[:9] and headers["Content-Range"]==f"bytes 0-8/{len(original)}", "PDF byte ranges return exact offsets")
    check(binary(first,id,range="bytes=-10")[1]==original[-10:], "suffix ranges work")
    check(binary(first,id,range="bytes=999999-")[0]==416 and binary(first,id,range="bytes=0-1,4-6")[0]==416, "out-of-bounds and multipart ranges are rejected")
    status, content, headers = binary(first,id,method="HEAD")
    check(status==200 and not content and int(headers["Content-Length"])==len(original), "HEAD returns correct headers without file bytes")
    check(headers["Cache-Control"]=="no-store, private" and headers["X-Content-Type-Options"]=="nosniff" and "sandbox" in headers["Content-Security-Policy"], "private binary responses prevent caching and active document execution")
    check(first.call("/storage/documents/test.bin")[0]==404, "uploaded storage is outside the web root")
    check(second.call("/api/v1/documents/update.php","POST",metadata(item,title="Forbidden"))[0]==404, "unrelated staff cannot edit documents")
    check(first.call("/api/v1/documents/update.php","POST",metadata(item,title="Nuevo título"),csrf=False)[0]==403, "metadata edits require CSRF")
    updated=first.call("/api/v1/documents/update.php","POST",metadata(item,title="Nuevo título"))[1]["data"]
    check(updated["title"]=="Nuevo título" and updated["version"]==2 and updated["file"]["version"]==1, "metadata edits persist without creating a binary version")
    check(first.call("/api/v1/documents/update.php","POST",metadata(item,title="Stale"))[0]==409 and detail(first,id)["title"]=="Nuevo título", "stale edits cannot overwrite current metadata")
    independent=Client(); assert independent.login(username,PASSWORD)[0]==200
    with ThreadPoolExecutor(2) as pool:
        responses=list(pool.map(lambda client: client.call("/api/v1/documents/update.php","POST",metadata(updated,title="Concurrent")), [first,independent]))
    check(sorted(response[0] for response in responses)==[200,409], "independent sessions serialize conflicting edits")
    current=detail(first,id); replacement=pdf_bytes("Archivo reemplazado",3)
    before=files()
    check(upload(first,{"id":id,"version":1},replacement,endpoint="replace-file")[0]==409 and files()==before, "stale replacement keeps original bytes and creates no orphan")
    status, replaced=upload(first,{"id":id,"version":current["version"]},replacement,endpoint="replace-file")
    check(status==200 and replaced["data"]["file"]["version"]==2 and len(replaced["data"]["file_versions"])==2, "replacement appends an immutable file version")
    check(binary(first,id,1)[1]==original and binary(first,id,2)[1]==replacement, "old and current versions remain independently retrievable")
    check(binary(second,id,1)[0]==404, "historical versions obey the same permissions")
    current=replaced["data"]
    trigger = 'document_failure_' + SUFFIX
    before_files = files(); before_count = sql('SELECT COUNT(*) AS n FROM documents WHERE uploader_user_id='+uid)[0]['n']
    admin_sql(f"CREATE TRIGGER {trigger} BEFORE INSERT ON document_versions FOR EACH ROW BEGIN IF NEW.uploaded_by = {uid} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected disposable storage transaction failure'; END IF; END")
    try:
        check(upload(first,fields(first,administrative),original)[0]==503 and files()==before_files and sql('SELECT COUNT(*) AS n FROM documents WHERE uploader_user_id='+uid)[0]['n']==before_count, "SQL failure compensates published bytes and rolls back document creation")
        check(upload(first,metadata(current,title='Should roll back'),replacement,endpoint='replace-file')[0]==503 and files()==before_files and detail(first,id)['title']==current['title'], "failed replacement rolls back both metadata and binary references")
    finally: admin_sql('DROP TRIGGER IF EXISTS '+trigger)
    body=metadata(current,title="Atomic title")
    status, replaced=upload(first,body,pdf_bytes("Atomic metadata and bytes"),endpoint="replace-file")
    check(status==200 and replaced["data"]["title"]=="Atomic title" and replaced["data"]["file"]["version"]==3, "metadata and replacement commit atomically from the edit form")
    current=replaced["data"]
    sql("UPDATE patients SET status='archived' WHERE id="+patient)
    check(first.call("/api/v1/documents/update.php","POST",metadata(current,description="Historical association"))[0]==200, "archived patient references can be preserved on existing records")
    check(upload(first,fields(first,medical,patient),original)[0]==422, "archived patients cannot be newly assigned")
    sql("UPDATE patients SET status='active' WHERE id="+patient)
    png=subprocess.run([PHP,"-r","$i=imagecreatetruecolor(80,50); imagepng($i);"],capture_output=True,check=True).stdout
    jpg=subprocess.run([PHP,"-r","$i=imagecreatetruecolor(80,50); imagejpeg($i);"],capture_output=True,check=True).stdout
    formats=[]
    for name, content in [("imagen.png",png),("imagen.jpeg",jpg),("documento.docx",docx_bytes())]:
        status, result=upload(first,fields(first,administrative,title=name),content,name)
        check(status==201, "valid "+name+" uploads without a patient for administrative category")
        record=result["data"]; formats.append(record)
        check(binary(first,record["id"],extra="&download=1")[1]==content, name+" download preserves exact original bytes")
    docx=next(record for record in formats if record["file"]["extension"]=="docx")
    check(binary(first,docx["id"])[2]["Content-Disposition"].startswith("attachment;"), "DOCX is download-only rather than pretending to have a browser preview")
    check(upload(first,fields(first,administrative),b"<svg/>","fake.png")[0]==415, "SVG disguised as PNG is rejected")
    check(upload(first,fields(first,administrative),b"PK broken","fake.docx")[0]==415, "invalid DOCX package is rejected")
    check(upload(first,fields(first,administrative),docx_bytes({"../evil":"x"}),"unsafe.docx")[0]==415, "DOCX traversal members are rejected")
    check(upload(first,fields(first,administrative),docx_bytes({"word/vbaProject.bin":"x"}),"unsafe.docx")[0]==415, "DOCX macros and embedded active objects are rejected")
    check(upload(first,fields(first,administrative),docx_bytes({"word/_rels/document.xml.rels":'<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>'}),"unsafe.docx")[0]==415, "DOCX external relationships are rejected")
    result=first.call("/api/v1/documents/list.php?page_size=1&type=pdf")[1]
    check(len(result["data"])==1 and result["meta"]["total"]==1 and result["meta"]["page_size"]==1, "SQL pagination and format filtering use the authorized result count")
    check(first.call("/api/v1/documents/list.php?q=Atomic")[1]["meta"]["total"]==1 and first.call("/api/v1/documents/list.php?q=%25")[1]["data"]==[], "search filters real records and escapes SQL wildcard input")
    check(first.call("/api/v1/documents/list.php?sort=DROP+TABLE")[0]==422, "sort fields are allowlisted")
    current=detail(first,id)
    check(second.call("/api/v1/documents/archive.php","POST",{"id":id,"version":current["version"]})[0]==404, "archive enforces ownership")
    archived=first.call("/api/v1/documents/archive.php","POST",{"id":id,"version":current["version"]})[1]["data"]
    check(archived["archived_at"] is not None and binary(first,id)[0]==404, "archive hides bytes without deleting file history")
    check(first.call("/api/v1/documents/list.php?state=archived")[1]["data"][0]["id"]==id and first.call("/api/v1/documents/list.php?type=pdf")[1]["data"]==[], "archived records appear only in the archived list")
    check(first.call("/api/v1/documents/update.php","POST",metadata(archived))[0]==409, "archived documents cannot be edited")
    restored=first.call("/api/v1/documents/restore.php","POST",{"id":id,"version":archived["version"]})[1]["data"]
    check(restored["archived_at"] is None and binary(first,id,1)[1]==original, "restore makes the retained original history accessible")
    old_files = files()
    orphans = [storage/'documents'/(secrets.token_hex(32)+'.bin'),storage/'quarantine'/(secrets.token_hex(32)+'.bin')]
    for path in orphans:
        path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(b'Orphan test'); os.utime(path,(time.time()-172800,)*2)
    for path in old_files: os.utime(path,(time.time()-172800,)*2)
    subprocess.run([PHP,'backend/php/cli/storage-gc.php'],cwd=ROOT,capture_output=True,check=True)
    check(files()==old_files and all(not path.exists() for path in orphans), "crash cleanup removes old orphan/quarantine files while retaining all ready versions")
    status,other=upload(second,fields(second,administrative),original)
    assert status==201
    own=detail(first,formats[0]["id"])
    request=[{"id":own["id"],"version":own["version"]},{"id":other["data"]["id"],"version":1}]
    result=first.call("/api/v1/documents/bulk-archive.php","POST",{"documents":request})[1]["data"]
    check(result[0]["success"] and not result[1]["success"] and result[1]["error"]["status"]==404, "bulk archive returns per-item outcomes without bypassing permission")
    duplicate=[{"id":id,"version":restored["version"]}]*2
    check(first.call("/api/v1/documents/bulk-archive.php","POST",{"documents":duplicate})[0]==422 and detail(first,id)["archived_at"] is None, "invalid bulk selections are rejected before any mutation")
    check(int(sql("SELECT COUNT(*) AS n FROM audit_events WHERE resource_type='document' AND resource_id="+id)[0]["n"])>=10, "document reads and mutations are audited with record IDs")
    check(sql("SELECT version FROM schema_migrations WHERE version='003_documents'")!=[], "fresh setup records the document migration")
    check(admin.call('/api/v1/admin/users/disable.php','POST',{'user_id':uid})[0]==200 and binary(first,id)[0]==401, "disabling an uploader revokes that account's document session")
    check(binary(manager,id)[0]==200, "retained hospital documents remain available to records managers after uploader disable")
    print(f"Completed {checks} document checks.")

if __name__=="__main__": main()
