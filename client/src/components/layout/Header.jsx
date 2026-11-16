import CourseSwitch from './CourseSwitch.jsx';
import Stats from './Stats.jsx';
import SoundButton from '../sound/SoundButton.jsx';

export const PAGE_NAMES = {learn: 'O‘rganish', shop: 'Shop', account: 'Hisob', report: 'Bizga yozing'};

export default function Header({page, activeCourse, onChooseCourse, onHome}) {
  return (
    <header>
      <a href="#" className="mobile-brand" data-action="home" onClick={e => { e.preventDefault(); onHome(); }}>Jenius<span>.</span></a>
      <div className="crumb">Shaxsiy o‘quv sayohating <span> / </span> <b>{PAGE_NAMES[page]}</b></div>
      <CourseSwitch active={activeCourse} onChoose={onChooseCourse} />
      <SoundButton where="main" />
      <Stats />
    </header>
  );
}
