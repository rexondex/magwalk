const express = require('express'); // Express 라이브러리 불러오기
const app = express();              // Express 애플리케이션 객체 생성
const PORT = 3000;                  // 서버를 열 포트 번호 설정

// 브라우저가 http://localhost:3000/ 에 접속했을 때(GET 요청)의 행동 정의
app.get('/', (req, res) => {
  res.send('Hello World! 서버가 정상적으로 작동 중입니다.');
});

// 지정한 포트(3000)로 서버를 열고 대기 상태로 진입
app.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});