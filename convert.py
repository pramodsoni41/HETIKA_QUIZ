# -*- coding: utf-8 -*-
"""
Created on Fri Mar  6 09:18:44 2026

@author: acer
"""

import json
import pandas as pd

# ========= SETTINGS =========
input_file = r"E:/Quiz_Mate/gk_quiz_questions.xlsx"
sheet_name = 0
output_file = "quiz.json"
# ===========================

# Read Excel
df = pd.read_excel(input_file, sheet_name=sheet_name)

# Clean column names
df.columns = [str(c).strip() for c in df.columns]

required_cols = ["question", "A", "B", "C", "D", "correct", "time"]
missing = [c for c in required_cols if c not in df.columns]

if missing:
    raise ValueError(f"Missing required columns: {missing}")

quiz_data = []

for i, row in df.iterrows():
    question = str(row["question"]).strip()

    answers = [
        str(row["A"]).strip(),
        str(row["B"]).strip(),
        str(row["C"]).strip(),
        str(row["D"]).strip(),
    ]

    # Excel correct = 1,2,3,4 -> JSON index = 0,1,2,3
    correct_val = str(row["correct"]).strip().upper()

    if correct_val in ["A", "B", "C", "D"]:
        correct_index = ord(correct_val) - ord("A")
    else:
        correct_index = int(correct_val) - 1
    
    if correct_index not in [0, 1, 2, 3]:
        raise ValueError(f"Row {i+2}: correct must be A,B,C,D or 1–4")

    time_sec = int(row["time"])

    item = {
        "question": question,
        "answers": answers,
        "correctAnswer": correct_index,
        "time": time_sec
    }

    quiz_data.append(item)

# Save JSON
with open(output_file, "w", encoding="utf-8") as f:
    json.dump(quiz_data, f, indent=2, ensure_ascii=False)

print(f"JSON file created successfully: {output_file}")
print(f"Total questions: {len(quiz_data)}")