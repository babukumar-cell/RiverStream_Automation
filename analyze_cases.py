import json
import os

with open('test_cases_extracted.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

summary = {}
all_test_cases = []

for sheet_name, rows in data.items():
    if not rows:
        continue
    
    # Identify header row
    header_idx = -1
    for idx, r in enumerate(rows):
        first_few = [str(c).strip().lower() for c in r[:5] if c]
        if any('test case id' in x or 'tc_id' in x or 'id' == x for x in first_few):
            header_idx = idx
            break
            
    if header_idx == -1:
        # Check if first row is header
        header = [str(c).strip() for c in rows[0] if c]
        data_rows = rows[1:]
    else:
        header = [str(c).strip() for c in rows[header_idx] if c]
        data_rows = rows[header_idx+1:]
        
    valid_cases = []
    sections = []
    
    for r in data_rows:
        cleaned = [str(c).strip() for c in r if str(c).strip() and str(c) != 'None']
        if not cleaned:
            continue
        
        # Check if it's a section header row
        first_val = str(r[0]).strip() if len(r) > 0 and r[0] is not None else ''
        second_val = str(r[1]).strip() if len(r) > 1 and r[1] is not None else ''
        
        if first_val.startswith('TC') or first_val.startswith('tc') or (first_val.isdigit() and int(first_val) > 0):
            case_info = {
                'id': first_val,
                'desc': second_val,
                'steps': str(r[2]).strip() if len(r) > 2 and r[2] is not None else '',
                'test_data': str(r[3]).strip() if len(r) > 3 and r[3] is not None else '',
                'expected': str(r[4]).strip() if len(r) > 4 and r[4] is not None else '',
                'actual': str(r[5]).strip() if len(r) > 5 and r[5] is not None else '',
                'result': str(r[6]).strip() if len(r) > 6 and r[6] is not None else '',
                'sheet': sheet_name
            }
            valid_cases.append(case_info)
            all_test_cases.append(case_info)
        elif len(cleaned) == 1 or (len(cleaned) > 1 and 'functionality' in cleaned[0].lower()):
            sections.append(cleaned[0])

    summary[sheet_name] = {
        'total_rows': len(rows),
        'valid_test_cases_count': len(valid_cases),
        'header': header,
        'sections': sections,
        'sample_cases': valid_cases[:3]
    }

print(f"Total sheets: {len(summary)}")
print(f"Total valid test cases identified: {len(all_test_cases)}")

for s_name, s_info in summary.items():
    print(f"\n--- Sheet: {s_name} ---")
    print(f"Total rows: {s_info['total_rows']}, Test cases: {s_info['valid_test_cases_count']}")
    if s_info['sections']:
        print(f"Sections ({len(s_info['sections'])}): {s_info['sections'][:5]}")
    for sc in s_info['sample_cases']:
        print(f"  [{sc['id']}] {sc['desc'][:60]}")

with open('summary_report.json', 'w', encoding='utf-8') as f:
    json.dump(summary, f, indent=2)
