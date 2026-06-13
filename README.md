<img width="1573" height="772" alt="image" src="https://github.com/user-attachments/assets/5bf588b3-4fc8-4475-91aa-567fa5449300" />

<img width="1244" height="888" alt="image" src="https://github.com/user-attachments/assets/0fc8cf08-d181-4ed0-aa29-f19f9ec49958" />

### MAGWALK

- 주로 스마트폰 브라우저를 통해 위치 수집 기능을 켠 후, 산책 코스 등 걸음 이력을 확인하기 위한 웰빙 웹 목표 중

---

### 사용법

1. 개발 시 `.env.local` 파일에 Neon DB 주소를 복사하여 사용하였음

2. `npm start` 프로그램 실행

3. 브라우저 위치 수집 권한 요청/허용

4. Collect ON

5. 3초마다 브라우저 기반의 현재 위치를 DB에 저장함

6. MapLibre/CARTO BaseMap Tile 기반의 지도 위에, DB에 저장된 기록을 위도/경도 점으로 표시
