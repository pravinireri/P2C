# P2C

turns old code like PowerBuilder into C#.  
also grades itself and writes tests.

---

## what it does

- reads legacy code  
- explains it  
- translates it  
- scores the result  
- generates tests  

---

# instructions

## backend
pip install -r requirements.txt  
py -m uvicorn backend.main:app --port 8000 --reload

## frontend
npm install  
npm run dev

run both in separate terminals 👍
