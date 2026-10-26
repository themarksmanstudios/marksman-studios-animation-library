"""Read the first worksheet of an XLSX file using Python's standard library."""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'rel': 'http://schemas.openxmlformats.org/package/2006/relationships'}

def col_index(cell_ref):
    letters = ''.join(ch for ch in cell_ref if ch.isalpha())
    value = 0
    for char in letters:
        value = value * 26 + ord(char.upper()) - 64
    return value - 1

def main(filename):
    with zipfile.ZipFile(filename) as book:
        shared = []
        if 'xl/sharedStrings.xml' in book.namelist():
            root = ET.fromstring(book.read('xl/sharedStrings.xml'))
            for si in root.findall('m:si', NS):
                shared.append(''.join(t.text or '' for t in si.findall('.//m:t', NS)))
        wb = ET.fromstring(book.read('xl/workbook.xml'))
        first = wb.find('m:sheets/m:sheet', NS)
        if first is None:
            print('[]'); return
        rid = first.attrib.get('{%s}id' % NS['r'])
        rels = ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))
        target = next(rel.attrib['Target'] for rel in rels.findall('rel:Relationship', NS) if rel.attrib['Id'] == rid)
        sheet_path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        sheet_path = sheet_path.replace('xl/xl/', 'xl/')
        root = ET.fromstring(book.read(sheet_path))
        rows = []
        for row in root.findall('.//m:sheetData/m:row', NS):
            values = []
            for cell in row.findall('m:c', NS):
                idx = col_index(cell.attrib.get('r', 'A1'))
                while len(values) <= idx: values.append('')
                value = cell.find('m:v', NS)
                inline = cell.find('m:is', NS)
                raw = value.text if value is not None else ''
                if cell.attrib.get('t') == 's' and raw: raw = shared[int(raw)]
                elif cell.attrib.get('t') == 'inlineStr' and inline is not None:
                    raw = ''.join(t.text or '' for t in inline.findall('.//m:t', NS))
                values[idx] = raw
            rows.append(values)
        if not rows: print('[]'); return
        headers = [str(v).strip() for v in rows[0]]
        result = [{header: (row[i] if i < len(row) else '') for i, header in enumerate(headers) if header}
                  for row in rows[1:] if any(str(v).strip() for v in row)]
        print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main(sys.argv[1])
