import json

data = json.load(open('scratch_recon_cases.json', encoding='utf-8'))

with open('all_recon_cases_readable.txt', 'w', encoding='utf-8') as f:
    for i, d in enumerate(data):
        f.write(f"[{i+1:02d}] {d.get('Test Case ID')}: {d.get('Test Case Description')}\n")
        f.write(f"     Steps: {repr(d.get('Steps to Reproduce', ''))}\n")
        f.write(f"     Expected: {repr(d.get('Expected Result', ''))}\n\n")

print(f"Wrote {len(data)} cases to all_recon_cases_readable.txt")
