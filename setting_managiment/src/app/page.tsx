import Link from "next/link";
import QRCode from "../components/qrcode/route";

export default function Home() {
  return (
    <main className="text-lg">
      <QRCode url="https://nextjs.org/" />
      <ul>
        <li className="my-6">
          <Link
            href="/"
            className="text-blue-500 hover:text-blue-700 cursor-pointer bg-gray-200 p-2 rounded-md"
          >
            Home
          </Link>
        </li>
        <li className="my-6">
          <Link
            href="/travel_management"
            className="text-blue-500 hover:text-blue-700 cursor-pointer bg-gray-200 p-2 rounded-md"
          >
            Travel Management
          </Link>
        </li>
      </ul>
    </main>
  );
}
