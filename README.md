# P2C

Turns old code like PowerBuilder into C#.  
Also grades itself and writes tests.

---

## What it does

- reads legacy code  
- explains it  
- translates it  
- scores the result  
- generates tests  

---

# quick start

## backend
pip install -r requirements.txt  
py -m uvicorn backend.main:app --port 8000 --reload

## frontend
npm install  
npm run dev

run both in separate terminals 👍
