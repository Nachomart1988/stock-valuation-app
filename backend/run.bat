@echo off
echo Installing dependencies...
pip install -r requirements.txt

echo.
echo Starting AdvanceValue Net API server...
echo Server will be available at http://localhost:8000
echo.

python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
