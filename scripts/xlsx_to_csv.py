"""Convert District23.xlsx (or any file with the same 54-column layout) to
CSV for scripts/import.sql's `\\copy`.

Usage: python xlsx_to_csv.py <in.xlsx> <out.csv>
"""
import csv
import datetime
import sys

import openpyxl


def cell_to_str(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.strftime("%Y-%m-%d")
    return str(value).strip()


def main(in_path: str, out_path: str) -> None:
    wb = openpyxl.load_workbook(in_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    header = next(rows)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        n = 0
        for row in rows:
            writer.writerow([cell_to_str(v) for v in row])
            n += 1
    print(f"wrote {n} rows to {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"usage: python {sys.argv[0]} <in.xlsx> <out.csv>")
        raise SystemExit(1)
    main(sys.argv[1], sys.argv[2])
