// Сова-талисман: только из CSS-блоков (декор, скринридеру не нужна).
export default function Mascot({size = ''}) {
  return (
    <div className={`mascot ${size}`.trim()} aria-hidden="true">
      <div className="ear left"></div><div className="ear right"></div>
      <div className="face"><i className="eye"></i><i className="eye"></i><i className="beak"></i></div>
      <div className="wing left"></div><div className="wing right"></div><div className="feet"></div>
    </div>
  );
}
