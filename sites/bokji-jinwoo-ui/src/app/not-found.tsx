import type { Metadata } from "next";
import Link from "@/components/SiteLink";

export const metadata: Metadata = { title: "찾을 수 없는 페이지" };

export default function NotFound() {
  return (
    <div className="wrap page narrow">
      <h1 className="h1">찾는 페이지가 없어요</h1>
      <p className="body">주소가 바뀌었거나 없어진 서비스일 수 있어요.</p>
      <p className="body">
        <Link href="/search">서비스 찾기</Link>에서 이름으로 찾거나, <Link href="/">처음 화면</Link>에서 상황으로 찾아 보세요. 상담: 보건복지상담센터 129
      </p>
    </div>
  );
}
