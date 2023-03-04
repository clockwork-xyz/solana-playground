import { useCallback, useState } from "react";
import styled from "styled-components";

import EditorWithTabs from "./EditorWithTabs";
import { MainViewLoading } from "../../../../../components/Loading";
import { EventName } from "../../../../../constants";
import { PgCommon, SetElementAsync } from "../../../../../utils/pg";
import { useGetAndSetStatic } from "../../../../../hooks";

const MainView = () => {
  const [El, setEl] = useState(EditorWithTabs);
  const [loading, setLoading] = useState(true);

  const setElWithTransition = useCallback(async (El: SetElementAsync) => {
    setLoading(true);
    await PgCommon.transition(
      (async () => {
        if (!El) El = EditorWithTabs;
        El = await (El as () => Promise<JSX.Element>)();
        setEl(El);
      })(),
      300
    );
    setLoading(false);
  }, []);

  useGetAndSetStatic(El, setElWithTransition, EventName.VIEW_MAIN_STATIC);

  if (loading) return <MainViewLoading tutorialsBg />;

  return <Wrapper>{El}</Wrapper>;
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

export default MainView;
