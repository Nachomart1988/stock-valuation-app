# Stock Analysis AI API - Backend

Neural Ensemble for Stock Valuation & Company Quality Assessment

## Tech Stack
- **FastAPI** - Modern Python web framework
- **PyTorch** - Deep learning models
- **Uvicorn** - ASGI server

## Models Implemented

### 1. AdvanceValueNet
- Endpoint: `/predict`
- Multi-model valuation ensemble (DCF, DDM, Graham, etc.)

### 2. CompanyQualityNet
- Endpoint: `/quality/predict`
- 5-dimension quality scoring

### 3. Neural Resumen Engine v2.0
- Endpoint: `/resumen/predict`
- 12-layer neural architecture for comprehensive analysis

### 4. Market Sentiment Engine
- Endpoint: `/market-sentiment/analyze`
- Market-wide sentiment analysis

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run server
python main.py

# Server runs on http://localhost:8000
# API docs at http://localhost:8000/docs
```

## Deploy to Railway

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login to Railway:
```bash
railway login
```

3. Deploy:
```bash
cd backend
railway init
railway up
```

4. Get your deployment URL:
```bash
railway domain
```

## Environment Variables

No environment variables required for basic operation.

## API Documentation

Once deployed, visit `/docs` for interactive API documentation (Swagger UI).
