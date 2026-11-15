/**
 * Điểm vào của ứng dụng trình duyệt.
 */
import { App } from './app';
import './styles.css';

const app = new App(document.getElementById('app')!);
// Móc gỡ lỗi/đo đạc: dùng từ console của trình duyệt (xem README, mục "Kiểm chứng trong trình duyệt").
(window as unknown as { habitat: App }).habitat = app;
